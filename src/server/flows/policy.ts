import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { detectInsult, type InsultMatch } from "@/lib/moderation/detect";
import type { BotConfig } from "@/lib/bot-config";
import { db } from "../db";
import { contacts, conversationActivity, conversations, flowRuns, products, tasks } from "../db/schema";
import type { Ctx } from "../authz/context";
import { log } from "../log";
import { sendOutbound } from "../services/outbound";
import { isAssignableMember } from "./settings";

export const OUT_OF_HOURS_NOTE = "La empresa está fuera de su horario de atención: si el cliente necesita algo que requiere a una persona, aclarale que lo atienden en el próximo horario hábil.";

/** Códigos de motivo de derivación registrados en actividad, ejecuciones y métricas. */
export type HandoffCode = "insult_detection" | "keyword" | "ai" | "max_attempts" | "out_of_hours" | "flow" | "error" | "quota" | "no_ai" | "team_route" | "high_value" | "tool_error" | "usage_limit" | "commercial_guard";

export const HANDOFF_LABELS: Record<HandoffCode, string> = {
  insult_detection: "Insulto o agresión detectada (sin IA)",
  keyword: "Palabra clave de derivación",
  ai: "La IA pidió una persona",
  max_attempts: "Consultas sin resolver",
  out_of_hours: "Fuera de horario",
  flow: "Paso del flujo",
  error: "Falla del bot",
  quota: "Cupo de IA agotado",
  no_ai: "Sin proveedor de IA",
  team_route: "Derivación del equipo de bots",
  high_value: "Oportunidad de alto valor",
  tool_error: "Error al ejecutar una acción",
  usage_limit: "Límite de uso de IA de la conversación",
  commercial_guard: "Respuesta con datos comerciales no verificados",
};

/**
 * Deriva la conversación a atención humana aplicando la política del bot:
 * 1. mensaje fijo de transferencia (plantilla estática, sin IA) mientras el bot aún tiene el control;
 * 2. estado "requested" (pide humano): el bot deja de responder y cualquier respuesta tardía se descarta;
 * 3. responsable configurado (si la conversación no tiene uno);
 * 4. tarea para el equipo (aviso);
 * 5. actividad con el motivo y su código.
 * Idempotente: si la conversación ya no estaba en modo bot, no repite efectos.
 */
export async function handoffWithPolicy(input: {
  tenantId: string;
  conversationId: string;
  botId: string;
  runId?: string | null;
  reason: string;
  code: HandoffCode;
  config: BotConfig;
  sendTransfer: boolean;
  data?: Record<string, unknown>;
  /** Clave del mensaje de transferencia (por defecto: ejecución + motivo). */
  transferKey?: string;
}): Promise<{ changed: boolean; assignedTo: string | null; taskId: string | null; transferSent: boolean }> {
  const { tenantId, conversationId, botId, config } = input;
  const ctx: Ctx = { tenantId, actor: { kind: "bot", botId, runId: input.runId ?? undefined } };
  let transferSent = false;
  const msg = config.handoff.transferMessage.trim();
  if (input.sendTransfer && msg) {
    try {
      const r = await sendOutbound(ctx, { conversationId, text: msg, idempotencyKey: input.transferKey ?? `handoff:${input.runId ?? conversationId}:${input.code}`, origin: { botId, runId: input.runId ?? undefined } });
      transferSent = !r.skipped;
    } catch (e) {
      // la derivación no depende del envío del mensaje (p. ej. ventana de 24 h cerrada)
      log.warn("handoff.transfer_message_failed", { tenantId, conversationId, err: (e as Error).message });
    }
  }
  const assignTo = (await isAssignableMember(tenantId, config.handoff.assignToUserId)) ? config.handoff.assignToUserId : null;

  const res = await db.transaction(async (tx) => {
    const upd = await tx
      .update(conversations)
      .set({ attentionMode: "requested", pendingBotMessage: null, updatedAt: new Date(), version: sql`${conversations.version} + 1` })
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId), eq(conversations.attentionMode, "bot")))
      .returning();
    if (!upd.length) return { changed: false as const, conv: null };
    const conv = upd[0];
    // otras ejecuciones del bot en esta conversación ya no deben responder
    await tx
      .update(flowRuns)
      .set({ status: "cancelled", lastError: "Conversación derivada a un humano", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.conversationId, conversationId), inArray(flowRuns.status, ["queued", "running", "waiting"]), input.runId ? ne(flowRuns.id, input.runId) : sql`true`));
    await tx.insert(conversationActivity).values({ tenantId, conversationId, kind: "handoff", actorKind: "bot", reason: input.reason.slice(0, 300), data: { botId, code: input.code, runId: input.runId ?? null, ...(input.data ?? {}) } });
    let assignedTo: string | null = conv.assigneeUserId;
    if (!conv.assigneeUserId && assignTo) {
      await tx.update(conversations).set({ assigneeUserId: assignTo }).where(and(eq(conversations.id, conversationId), isNull(conversations.assigneeUserId)));
      await tx.insert(conversationActivity).values({ tenantId, conversationId, kind: "assigned", actorKind: "bot", reason: "Asignación por derivación del bot", data: { to: assignTo, botId } });
      assignedTo = assignTo;
    }
    return { changed: true as const, conv: { ...conv, assigneeUserId: assignedTo } };
  });
  if (!res.changed || !res.conv) return { changed: false, assignedTo: null, taskId: null, transferSent };

  let taskId: string | null = null;
  if (config.handoff.notifyTeam) {
    const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, res.conv.contactId), eq(contacts.tenantId, tenantId)) });
    const [t] = await db
      .insert(tasks)
      .values({
        tenantId,
        title: `Atender conversación derivada: ${contact?.name ?? "contacto"}`.slice(0, 160),
        description: `${HANDOFF_LABELS[input.code]}. ${input.reason}`.slice(0, 2000),
        assigneeUserId: res.conv.assigneeUserId,
        dueAt: new Date(Date.now() + 30 * 60_000),
        contactId: res.conv.contactId,
        createdByKind: "bot",
      })
      .returning({ id: tasks.id });
    taskId = t.id;
  }
  return { changed: true, assignedTo: res.conv.assigneeUserId, taskId, transferSent };
}

/** Términos a ignorar por la detección: los configurados y los títulos del catálogo de la empresa. */
async function ignoredTermsFor(tenantId: string, config: BotConfig) {
  const rows = await db.select({ title: products.title }).from(products).where(and(eq(products.tenantId, tenantId), isNull(products.archivedAt))).limit(2000);
  return [...config.handoff.ignoredInsultTerms, ...rows.map((r) => r.title)];
}

/**
 * Evaluación previa a cualquier llamada a la IA. Si el mensaje contiene un insulto o agresión
 * (según la configuración), devuelve las coincidencias para derivar sin consumir la API del cliente.
 */
export async function checkInsult(tenantId: string, config: BotConfig, message: string): Promise<{ flagged: boolean; matches: InsultMatch[] }> {
  if (!config.handoff.insultDetection || !message.trim()) return { flagged: false, matches: [] };
  return detectInsult(message, { extraTerms: config.handoff.extraInsultTerms, ignoredTerms: await ignoredTermsFor(tenantId, config) });
}
