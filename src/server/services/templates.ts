import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { conversations } from "../db/schema";
import { assertCan, type Ctx } from "../authz/context";
import { getTenantChatwoot } from "../chatwoot/tenant-client";
import { badRequest, notFound, policyBlocked } from "../http/errors";
import { sendOutbound } from "./outbound";

/**
 * Plantillas aprobadas de WhatsApp para reabrir una conversación fuera de la ventana de 24 h.
 * Fuente: `message_templates` del inbox de Chatwoot (sincronizado desde la WABA del cliente con
 * POST inboxes/:id/sync_templates). Chatwoot v4.19 solo envía plantillas APPROVED (nombre + idioma)
 * y arma los parámetros de cuerpo por posición; acá se valida antes para no gastar un envío fallido.
 * Alcance V1: plantillas con parámetros de cuerpo (texto). Encabezados multimedia o botones con
 * parámetros se muestran como no disponibles desde Loopchat.
 */
type RawTemplate = { name?: unknown; language?: unknown; status?: unknown; category?: unknown; components?: { type?: string; format?: string; text?: string; buttons?: { type?: string; url?: string }[] }[] };

export type TemplateView = { name: string; language: string; category: string; body: string; params: number; available: boolean; unavailableReason: string | null };

const placeholderCount = (text: string) => Math.max(0, ...[...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])));

export function toTemplateView(t: RawTemplate): TemplateView | null {
  if (typeof t.name !== "string" || typeof t.language !== "string" || String(t.status ?? "").toUpperCase() !== "APPROVED") return null;
  const comps = Array.isArray(t.components) ? t.components : [];
  const body = comps.find((c) => String(c.type).toUpperCase() === "BODY")?.text ?? "";
  const header = comps.find((c) => String(c.type).toUpperCase() === "HEADER");
  const buttons = comps.find((c) => String(c.type).toUpperCase() === "BUTTONS")?.buttons ?? [];
  let reason: string | null = null;
  if (header && String(header.format ?? "TEXT").toUpperCase() !== "TEXT") reason = "Tiene encabezado multimedia: enviala desde Chatwoot.";
  else if (header?.text && placeholderCount(header.text) > 0) reason = "El encabezado tiene parámetros: enviala desde Chatwoot.";
  else if (buttons.some((b) => /\{\{/.test(b.url ?? ""))) reason = "Tiene botones con parámetros: enviala desde Chatwoot.";
  return { name: t.name, language: t.language, category: String(t.category ?? ""), body, params: placeholderCount(body), available: !reason && Boolean(body), unavailableReason: reason ?? (body ? null : "Sin texto de cuerpo.") };
}

/** Meta rechaza parámetros vacíos, con saltos de línea/tabulaciones o más de 4 espacios seguidos. */
const paramSchema = z
  .string()
  .trim()
  .min(1, "Completá todos los campos de la plantilla.")
  .max(1024)
  .refine((v) => !/[\n\t]/.test(v) && !/ {5,}/.test(v), "Los campos no pueden tener saltos de línea, tabulaciones ni más de 4 espacios seguidos.");

export const sendTemplateSchema = z.object({ name: z.string().min(1).max(512), language: z.string().min(2).max(15), params: z.array(paramSchema).max(20), idempotencyKey: z.string().min(8).max(200) });

async function loadConversation(ctx: Ctx, conversationId: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, ctx.tenantId)) });
  if (!conv) throw notFound("Conversación no encontrada.");
  if (!conv.chatwootInboxId) throw policyBlocked("La conversación no tiene un número de WhatsApp asociado.");
  return conv;
}

export async function listTemplates(ctx: Ctx, conversationId: string, opts: { sync?: boolean } = {}) {
  assertCan(ctx, "conversation:reply");
  const conv = await loadConversation(ctx, conversationId);
  const { client } = await getTenantChatwoot(ctx.tenantId);
  if (opts.sync) await client.syncTemplates(conv.chatwootInboxId!);
  const inbox = await client.getInbox(conv.chatwootInboxId!);
  const list = (Array.isArray(inbox.message_templates) ? inbox.message_templates : []) as RawTemplate[];
  return { templates: list.map(toTemplateView).filter((t): t is TemplateView => Boolean(t)) };
}

export function renderTemplate(body: string, params: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? "");
}

export async function sendTemplate(ctx: Ctx, conversationId: string, input: z.input<typeof sendTemplateSchema>) {
  assertCan(ctx, "conversation:reply");
  const data = sendTemplateSchema.parse(input);
  const { templates } = await listTemplates(ctx, conversationId);
  const t = templates.find((x) => x.name === data.name && x.language.toLowerCase() === data.language.toLowerCase());
  if (!t) throw badRequest("La plantilla no existe o no está aprobada por Meta. Actualizá la lista.");
  if (!t.available) throw badRequest(t.unavailableReason ?? "Plantilla no disponible.");
  if (data.params.length !== t.params) throw badRequest(`La plantilla necesita ${t.params} dato(s).`);
  const text = renderTemplate(t.body, data.params);
  return sendOutbound(ctx, { conversationId, text, idempotencyKey: `tpl:${data.idempotencyKey}`, template: { name: t.name, language: t.language, params: data.params } });
}
