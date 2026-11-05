import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { channelConnections, conversationActivity, conversations, flowRuns, messages } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { ChatwootError } from "../chatwoot/client";
import { getTenantChatwoot } from "../chatwoot/tenant-client";
import { preview } from "../chatwoot/sync";
import { badRequest, forbidden, notFound, policyBlocked, upstream } from "../http/errors";
import { log } from "../log";
import { assertOperational, recordUsage } from "./usage";
import { loadPhotoForSend } from "./products";

export const META_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowState(lastIncomingAt: Date | null, now = Date.now()) {
  if (!lastIncomingAt) return { open: false as const, reason: "El contacto todavía no escribió: WhatsApp solo permite iniciar con una plantilla aprobada." };
  const closesAt = new Date(lastIncomingAt.getTime() + META_WINDOW_MS);
  if (closesAt.getTime() <= now) return { open: false as const, closesAt, reason: "Pasaron más de 24 h desde el último mensaje del contacto: WhatsApp solo permite responder con una plantilla aprobada." };
  return { open: true as const, closesAt };
}

export type SendInput = {
  conversationId: string;
  text: string;
  idempotencyKey: string;
  origin?: { botId?: string; versionId?: string; runId?: string; provider?: string; model?: string; attachment?: { productId: string } };
  /** Foto de un producto del catálogo de la empresa (se envía como adjunto con `text` como pie). */
  attachment?: { productId: string };
};

/**
 * Cancela ejecuciones de bot activas de la conversación y las respuestas del bot que todavía no
 * empezaron a enviarse (llamar dentro de la transacción de la toma humana). También descarta el
 * mensaje pendiente: lo atiende la persona.
 */
async function cancelActiveRuns(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: string, conversationId: string, reason: string) {
  await tx
    .update(flowRuns)
    .set({ status: "cancelled", lastError: reason, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.conversationId, conversationId), inArray(flowRuns.status, ["queued", "running", "waiting"])));
  await tx
    .update(messages)
    .set({ status: "cancelled", error: "Descartada: una persona tomó la conversación", updatedAt: new Date() })
    .where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId), eq(messages.senderKind, "bot"), eq(messages.status, "pending")));
  await tx.update(conversations).set({ pendingBotMessage: null }).where(eq(conversations.id, conversationId));
}

/**
 * Único camino de salida (humano o bot) → Chatwoot → WhatsApp.
 * - Bot: solo envía si la conversación sigue en modo bot (verificado con lock de fila).
 * - Humano: al responder toma el control (bot pausado y ejecuciones canceladas) antes de enviar.
 * - Idempotente por idempotencyKey (doble click / reintentos no duplican).
 */
export async function sendOutbound(ctx: Ctx, input: SendInput): Promise<{ messageId: string; status: string; skipped?: boolean; duplicate?: boolean }> {
  assertCan(ctx, "conversation:reply");
  const text = input.text.trim();
  if (!text) throw badRequest("El mensaje está vacío.");
  if (text.length > 4096) throw badRequest("El mensaje supera los 4096 caracteres de WhatsApp.");
  if (!/^[\w:.\-]{8,200}$/.test(input.idempotencyKey)) throw badRequest("Clave de idempotencia inválida.");
  await assertOperational(ctx.tenantId);

  const prepared = await db.transaction(async (tx) => {
    const lock = await tx.execute<{ id: string }>(sql`select id from conversations where id = ${input.conversationId} and tenant_id = ${ctx.tenantId} for update`);
    if (lock.rows.length === 0) throw notFound("Conversación no encontrada.");
    const conv = (await tx.query.conversations.findFirst({ where: eq(conversations.id, input.conversationId) }))!;

    const existing = await tx.query.messages.findFirst({ where: and(eq(messages.tenantId, ctx.tenantId), eq(messages.idempotencyKey, input.idempotencyKey)) });
    if (existing) return { duplicate: true as const, message: existing, conv };

    const win = windowState(conv.lastIncomingAt);
    if (!win.open) throw policyBlocked(win.reason, { reason: "meta_window_closed" });
    if (conv.channelConnectionId) {
      const ch = await tx.query.channelConnections.findFirst({ where: eq(channelConnections.id, conv.channelConnectionId) });
      if (ch?.status === "disconnected") throw policyBlocked("El número de WhatsApp de esta conversación fue desconectado.", { reason: "channel_disconnected" });
    }

    if (ctx.actor.kind === "bot") {
      if (conv.attentionMode !== "bot") return { skipped: true as const, conv };
      // la ejecución que generó la respuesta fue cancelada (toma humana, derivación, pausa)
      if (ctx.actor.runId) {
        const r = await tx.execute<{ status: string }>(sql`select status from flow_runs where id = ${ctx.actor.runId} for share`);
        if (r.rows[0] && r.rows[0].status !== "running") return { skipped: true as const, conv };
      }
      // equipos: solo responde el bot activo (respuestas tardías de un bot anterior se descartan)
      if (conv.teamId && conv.activeBotId && conv.activeBotId !== ctx.actor.botId) return { skipped: true as const, conv };
    } else if (ctx.actor.kind === "user") {
      const uid = ctx.actor.userId;
      if (conv.assigneeUserId && conv.assigneeUserId !== uid && !(ctx.actor.role === "tenant_admin" || ctx.actor.role === "manager")) {
        throw forbidden("Esta conversación tiene otro responsable. Pedí que te la reasignen para responder.");
      }
      const patch: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date(), version: conv.version + 1 };
      if (!conv.assigneeUserId) {
        patch.assigneeUserId = uid;
        await tx.insert(conversationActivity).values({ tenantId: ctx.tenantId, conversationId: conv.id, kind: "assigned", actorKind: "user", actorUserId: uid, reason: "Tomó la conversación al responder", data: { to: uid } });
      }
      if (conv.attentionMode === "bot" || conv.attentionMode === "requested") {
        patch.attentionMode = "human";
        await tx.insert(conversationActivity).values({ tenantId: ctx.tenantId, conversationId: conv.id, kind: "handoff", actorKind: "user", actorUserId: uid, reason: "Respuesta manual del agente" });
        await cancelActiveRuns(tx, ctx.tenantId, conv.id, "Un agente respondió manualmente");
      }
      await tx.update(conversations).set(patch).where(eq(conversations.id, conv.id));
    }

    const [msg] = await tx
      .insert(messages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: conv.id,
        direction: "out",
        senderKind: ctx.actor.kind === "bot" ? "bot" : ctx.actor.kind === "user" ? "agent" : "system",
        authorUserId: actorUserId(ctx),
        status: "pending",
        idempotencyKey: input.idempotencyKey,
        pendingContent: text,
        origin: input.attachment ? { ...(input.origin ?? {}), attachment: input.attachment } : input.origin,
      })
      .returning();
    return { message: msg, conv };
  });

  if ("skipped" in prepared && prepared.skipped) return { messageId: "", status: "skipped", skipped: true };
  if ("duplicate" in prepared && prepared.duplicate) return { messageId: prepared.message.id, status: prepared.message.status, duplicate: true };
  const { message, conv } = prepared as { message: typeof messages.$inferSelect; conv: typeof conversations.$inferSelect };
  return deliver(ctx.tenantId, message.id, conv.chatwootConversationId, text, input.idempotencyKey, input.attachment);
}

async function deliver(tenantId: string, messageId: string, chatwootConversationId: number, text: string, idempotencyKey: string, attachment?: { productId: string }) {
  // reclamo del envío: si una toma humana canceló la respuesta en el medio, no sale
  const claimed = await db.update(messages).set({ status: "sending", updatedAt: new Date() }).where(and(eq(messages.id, messageId), eq(messages.status, "pending"))).returning({ id: messages.id });
  if (!claimed.length) return { messageId, status: "cancelled", skipped: true };
  try {
    const { client } = await getTenantChatwoot(tenantId);
    let res;
    if (attachment) {
      const photo = await loadPhotoForSend(tenantId, attachment.productId);
      if (!photo) throw new ChatwootError(0, "El producto ya no tiene foto disponible.");
      res = await client.sendAttachment(chatwootConversationId, { content: text, file: { bytes: photo.bytes, mime: photo.mime, name: photo.fileName }, contentAttributes: { loopchat_message_id: idempotencyKey } });
    } else res = await client.sendMessage(chatwootConversationId, { content: text, contentAttributes: { loopchat_message_id: idempotencyKey } });
    const failed = res.status === "failed";
    await db
      .update(messages)
      .set({
        chatwootMessageId: res.id,
        status: failed ? "failed" : sql`case when ${messages.status} in ('delivered','read') then ${messages.status} else 'sent' end`,
        error: failed ? String((res.content_attributes as { external_error?: string } | null)?.external_error ?? "Falló el envío") : null,
        pendingContent: failed ? text : null,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, messageId));
    const now = new Date();
    await db
      .update(conversations)
      .set({ lastMessageAt: now, lastMessagePreview: preview(text), lastMessageDirection: "out", firstResponseAt: sql`coalesce(${conversations.firstResponseAt}, ${now})`, unreadCount: 0, updatedAt: now })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.chatwootConversationId, chatwootConversationId)));
    await recordUsage(tenantId, "messages_out", `msg:${res.id}`);
    return { messageId, status: failed ? "failed" : "sent" };
  } catch (e) {
    const msg = e instanceof ChatwootError ? e.message : "No se pudo entregar el mensaje al motor de mensajería.";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300), updatedAt: new Date() }).where(eq(messages.id, messageId));
    log.warn("outbound.failed", { tenantId, messageId, err: msg });
    throw upstream(`No se envió: ${msg}`, { messageId, retryable: true });
  }
}

/** Reintenta un mensaje fallido (mismo registro y misma clave: no se duplica). */
export async function retryOutbound(ctx: Ctx, messageId: string) {
  assertCan(ctx, "conversation:reply");
  await assertOperational(ctx.tenantId);
  const m = await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.tenantId, ctx.tenantId)) });
  if (!m) throw notFound();
  if (m.status !== "failed" || !m.pendingContent || m.chatwootMessageId) throw badRequest("Solo se pueden reintentar mensajes fallidos que no llegaron a Chatwoot.");
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, m.conversationId) });
  if (!conv) throw notFound();
  const win = windowState(conv.lastIncomingAt);
  if (!win.open) throw policyBlocked(win.reason, { reason: "meta_window_closed" });
  if (ctx.actor.kind === "user" && conv.assigneeUserId && conv.assigneeUserId !== ctx.actor.userId && ctx.actor.role === "agent") throw forbidden();
  const claimed = await db.update(messages).set({ status: "pending", error: null, updatedAt: new Date() }).where(and(eq(messages.id, m.id), eq(messages.status, "failed"))).returning({ id: messages.id });
  if (claimed.length === 0) throw badRequest("El mensaje ya se está reintentando.");
  return deliver(ctx.tenantId, m.id, conv.chatwootConversationId, m.pendingContent, m.idempotencyKey!, (m.origin as { attachment?: { productId: string } } | null)?.attachment);
}

export { cancelActiveRuns };
