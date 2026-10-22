import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { conversations, opportunities, stages, tasks, type ConversationBotState } from "../db/schema";
import { getCatalogItems } from "../services/products";

/**
 * Memoria comercial acotada: solo lo pertinente del CRM de ESTA empresa y ESTE contacto,
 * con límites de cantidad y de largo (no se envía el historial completo al modelo).
 */
export const MEMORY_MAX_CHARS = 1200;

/** pipelineIds: solo oportunidades de los pipelines que el bot tiene autorizados. */
export async function buildCommercialMemory(tenantId: string, contactId: string, conversationId: string | null, pipelineIds?: string[]): Promise<string> {
  const lines: string[] = [];
  const prev = await db
    .select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt, preview: conversations.lastMessagePreview, botState: conversations.botState })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId), conversationId ? ne(conversations.id, conversationId) : undefined))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(5);
  if (prev.length) {
    const last = prev[0];
    lines.push(`- Conversaciones anteriores: ${prev.length}${prev.length === 5 ? "+" : ""}. Última interacción: ${last.lastMessageAt ? last.lastMessageAt.toISOString().slice(0, 10) : "sin fecha"}${last.preview ? ` ("${last.preview.slice(0, 90)}")` : ""}.`);
  }
  const opps = await db
    .select({ title: opportunities.title, amount: opportunities.amount, currency: opportunities.currency, stage: stages.name })
    .from(opportunities)
    .innerJoin(stages, eq(stages.id, opportunities.stageId))
    .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, contactId), eq(opportunities.status, "open"), pipelineIds ? (pipelineIds.length ? inArray(opportunities.pipelineId, pipelineIds) : sql`false`) : undefined))
    .orderBy(desc(opportunities.lastActivityAt))
    .limit(3);
  for (const o of opps) lines.push(`- Oportunidad abierta: ${o.title.slice(0, 80)} (etapa: ${o.stage}${o.amount ? `, monto ${o.currency} ${Number(o.amount).toLocaleString("es-AR")}` : ""}).`);
  const pending = await db
    .select({ title: tasks.title, dueAt: tasks.dueAt })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.contactId, contactId), eq(tasks.status, "pending")))
    .orderBy(asc(tasks.dueAt))
    .limit(3);
  for (const t of pending) lines.push(`- Tarea pendiente del equipo: ${t.title.slice(0, 80)}${t.dueAt ? ` (vence ${t.dueAt.toISOString().slice(0, 10)})` : ""}.`);
  const current = conversationId ? await db.query.conversations.findFirst({ columns: { botState: true }, where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)) }) : null;
  const productIds = [...new Set([...(((current?.botState ?? {}) as ConversationBotState).productIds ?? []), ...prev.flatMap((p) => ((p.botState ?? {}) as ConversationBotState).productIds ?? [])])].slice(0, 8);
  if (productIds.length) {
    const items = await getCatalogItems(tenantId, productIds);
    if (items.length) lines.push(`- Productos por los que consultó: ${items.map((i) => i.title.slice(0, 50)).join(", ")}.`);
  }
  let out = lines.join("\n");
  if (out.length > MEMORY_MAX_CHARS) out = out.slice(0, MEMORY_MAX_CHARS - 1) + "…";
  return out;
}
