import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { toE164 } from "@/lib/phone";
import { db, type Tx } from "../db";
import {
  botTeams,
  channelConnections,
  contacts,
  conversationActivity,
  conversations,
  messages,
  opportunities,
  pipelines,
  stages,
  tenants,
  webhookEvents,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { log } from "../log";
import { recordUsage } from "../services/usage";
import { triggerBotForIncoming } from "../flows/trigger";
import { getTenantChatwoot } from "./tenant-client";
import type { CwApiMessage, CwConversation, CwWebhookConversation, CwWebhookMessage } from "./types";

const PREVIEW_LEN = 140;
export const preview = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN);

function mapStatus(s: string | undefined): "open" | "pending" | "resolved" | "snoozed" {
  return s === "pending" || s === "resolved" || s === "snoozed" ? s : "open";
}

async function channelForInbox(tx: Tx, tenantId: string, inboxId: number | undefined) {
  if (!inboxId) return null;
  return tx.query.channelConnections.findFirst({ where: and(eq(channelConnections.tenantId, tenantId), eq(channelConnections.chatwootInboxId, inboxId)) });
}

/** Contacto único por (tenant, canal, teléfono E.164). Nunca se fusiona entre empresas. */
export async function upsertContactFromChatwoot(tx: Tx, tenantId: string, ref: { id?: number; name?: string | null; phone_number?: string | null } | undefined, channelId: string | null, fallbackSourceId?: string | null) {
  const phone = toE164(ref?.phone_number ?? null) ?? toE164(fallbackSourceId ?? null);
  const name = (ref?.name || "").trim() || phone || "Contacto sin nombre";
  if (phone) {
    const found = await tx.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, phone), channelId ? eq(contacts.channelConnectionId, channelId) : isNull(contacts.channelConnectionId)),
    });
    if (found) {
      if (ref?.id && !found.chatwootContactId) await tx.update(contacts).set({ chatwootContactId: ref.id, updatedAt: new Date() }).where(eq(contacts.id, found.id));
      return found;
    }
  } else if (ref?.id) {
    const found = await tx.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.chatwootContactId, ref.id)) });
    if (found) return found;
  }
  const [created] = await tx
    .insert(contacts)
    .values({ tenantId, name, phoneE164: phone, channelConnectionId: channelId, chatwootContactId: ref?.id ?? null })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // carrera: otro proceso lo creó
  const again = await tx.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.phoneE164, phone!)) });
  return again!;
}

export async function upsertConversationFromChatwoot(tx: Tx, tenantId: string, conv: CwConversation, opts: { incoming?: boolean } = {}) {
  const existing = await tx.query.conversations.findFirst({ where: and(eq(conversations.tenantId, tenantId), eq(conversations.chatwootConversationId, conv.id)) });
  if (existing) {
    if (conv.status && mapStatus(conv.status) !== existing.status) {
      // al resolverse, la conversación deja de usar la versión fijada del equipo (la próxima usa la vigente)
      const unpin = mapStatus(conv.status) === "resolved" ? { teamId: null, teamVersionId: null, activeBotId: null } : {};
      await tx.update(conversations).set({ status: mapStatus(conv.status), ...unpin, updatedAt: new Date(), version: existing.version + 1 }).where(eq(conversations.id, existing.id));
      return { ...existing, status: mapStatus(conv.status) };
    }
    return existing;
  }
  const channel = await channelForInbox(tx, tenantId, conv.inbox_id);
  const contact = await upsertContactFromChatwoot(tx, tenantId, conv.meta?.sender, channel?.id ?? null, conv.contact_inbox?.source_id);
  const [created] = await tx
    .insert(conversations)
    .values({
      tenantId,
      chatwootConversationId: conv.id,
      chatwootInboxId: conv.inbox_id,
      channelConnectionId: channel?.id ?? null,
      contactId: contact.id,
      status: mapStatus(conv.status),
      attentionMode: "bot",
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    void opts;
    return created;
  }
  return (await tx.query.conversations.findFirst({ where: and(eq(conversations.tenantId, tenantId), eq(conversations.chatwootConversationId, conv.id)) }))!;
}

async function maybeCreateOpportunity(tx: Tx, tenantId: string, contactId: string, conversationId: string, contactName: string, channelConnectionId: string | null = null, teamId: string | null = null) {
  const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (tenant?.settings?.autoCreateOpportunity === false) return null;
  // con un equipo de chatbots activo, las oportunidades las crean los bots según las reglas de su
  // pipeline (un reclamo no es una venta; la recepcionista no crea oportunidades)
  if (teamId) return null;
  const team = await tx.query.botTeams.findFirst({
    columns: { id: true },
    where: and(eq(botTeams.tenantId, tenantId), eq(botTeams.status, "active"), channelConnectionId ? or(eq(botTeams.channelConnectionId, channelConnectionId), isNull(botTeams.channelConnectionId)) : isNull(botTeams.channelConnectionId)),
  });
  if (team) return null;
  const open = await tx.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, contactId), eq(opportunities.status, "open")) });
  if (open) {
    if (!open.conversationId) await tx.update(opportunities).set({ conversationId }).where(eq(opportunities.id, open.id));
    return null;
  }
  const pipeline = await tx.query.pipelines.findFirst({ where: and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true)) });
  if (!pipeline) return null;
  const first = await tx.query.stages.findFirst({ where: and(eq(stages.pipelineId, pipeline.id), eq(stages.kind, "open")), orderBy: (s, { asc }) => [asc(s.position)] });
  if (!first) return null;
  const [opp] = await tx
    .insert(opportunities)
    .values({ tenantId, pipelineId: pipeline.id, stageId: first.id, contactId, conversationId, title: `Consulta de ${contactName}`, source: "whatsapp", currency: tenant?.defaultCurrency ?? "ARS" })
    .returning();
  return opp;
}

async function handleMessageCreated(tenantId: string, p: CwWebhookMessage) {
  if (p.private || p.message_type === "activity") return "ignored";
  const result = await db.transaction(async (tx) => {
    const conv = await upsertConversationFromChatwoot(tx, tenantId, p.conversation, { incoming: p.message_type === "incoming" });
    const createdAt = p.created_at ? new Date(p.created_at) : new Date();
    const text = p.content ?? (p.attachments?.length ? `[${p.attachments[0].file_type}]` : "");
    if (p.message_type === "incoming") {
      const inserted = await tx
        .insert(messages)
        .values({ tenantId, conversationId: conv.id, chatwootMessageId: p.id, direction: "in", senderKind: "contact", status: "delivered", createdAt })
        .onConflictDoNothing()
        .returning({ id: messages.id });
      // Reintento de un evento ya registrado: no se duplica nada, pero se vuelve a intentar el
      // disparo del bot (idempotente por mensaje) por si el intento anterior falló después del commit.
      if (inserted.length === 0) return { kind: "incoming" as const, conversationId: conv.id, attentionMode: conv.attentionMode, text: p.content ?? "", hasAttachments: Boolean(p.attachments?.length), duplicate: true };
      await tx
        .update(conversations)
        .set({
          lastIncomingAt: createdAt,
          lastMessageAt: createdAt,
          lastMessagePreview: preview(text),
          lastMessageDirection: "in",
          unreadCount: sql`${conversations.unreadCount} + 1`,
          status: mapStatus(p.conversation.status),
          updatedAt: new Date(),
          version: sql`${conversations.version} + 1`,
        })
        .where(eq(conversations.id, conv.id));
      await recordUsage(tenantId, "messages_in", `msg:${p.id}`, tx);
      const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
      await maybeCreateOpportunity(tx, tenantId, conv.contactId, conv.id, contact?.name ?? "contacto", conv.channelConnectionId, conv.teamId);
      return { kind: "incoming" as const, conversationId: conv.id, attentionMode: conv.attentionMode, text: p.content ?? "", hasAttachments: Boolean(p.attachments?.length), duplicate: false };
    }
    // saliente (outgoing/template): ¿lo envió Loopchat?
    const marker = (p.content_attributes as { loopchat_message_id?: string } | null)?.loopchat_message_id;
    if (marker) {
      await tx
        .update(messages)
        .set({ chatwootMessageId: p.id, status: sql`case when ${messages.status} in ('pending', 'sending') then 'sent' else ${messages.status} end`, updatedAt: new Date() })
        .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, marker)));
      return { kind: "own_echo" as const };
    }
    const inserted = await tx
      .insert(messages)
      .values({ tenantId, conversationId: conv.id, chatwootMessageId: p.id, direction: "out", senderKind: "agent", status: "sent", isTemplate: p.message_type === "template", createdAt })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length === 0) return { kind: "duplicate" as const };
    await tx
      .update(conversations)
      .set({ lastMessageAt: createdAt, lastMessagePreview: preview(text), lastMessageDirection: "out", firstResponseAt: sql`coalesce(${conversations.firstResponseAt}, ${createdAt})`, updatedAt: new Date() })
      .where(eq(conversations.id, conv.id));
    await recordUsage(tenantId, "messages_out", `msg:${p.id}`, tx);
    // Un humano respondió directamente desde Chatwoot: el bot se detiene para no responder en paralelo.
    if (conv.attentionMode === "bot" || conv.attentionMode === "requested") {
      await tx.update(conversations).set({ attentionMode: "human", version: sql`${conversations.version} + 1` }).where(eq(conversations.id, conv.id));
      await tx.insert(conversationActivity).values({ tenantId, conversationId: conv.id, kind: "handoff", actorKind: "system", reason: "Respuesta manual enviada desde Chatwoot" });
    }
    return { kind: "external_outgoing" as const, conversationId: conv.id };
  });
  if (result.kind === "incoming" && result.attentionMode === "bot") {
    await triggerBotForIncoming({ tenantId, conversationId: result.conversationId, chatwootMessageId: p.id, text: result.text, hasAttachments: result.hasAttachments });
  }
  return result.kind === "incoming" && result.duplicate ? "duplicate" : result.kind;
}

async function handleMessageUpdated(tenantId: string, p: CwWebhookMessage) {
  const local = await db.query.messages.findFirst({ where: and(eq(messages.tenantId, tenantId), eq(messages.chatwootMessageId, p.id)) });
  if (!local) return "ignored";
  const extError = (p.content_attributes as { external_error?: string } | null)?.external_error;
  if (extError) {
    await db.update(messages).set({ status: "failed", error: String(extError).slice(0, 300), updatedAt: new Date() }).where(eq(messages.id, local.id));
    return "failed";
  }
  // El webhook no incluye `status`: se consulta a la API para no afirmar entregas sin evidencia.
  await enqueue("chatwoot.reconcile_status", { conversationId: local.conversationId }, { tenantId, dedupKey: `rs:${local.conversationId}:${Math.floor(Date.now() / 5000)}` });
  return "reconcile";
}

async function handleConversationEvent(tenantId: string, p: CwWebhookConversation) {
  await db.transaction(async (tx) => {
    await upsertConversationFromChatwoot(tx, tenantId, p);
  });
  return "synced";
}

/** Procesa un evento persistido (idempotente: puede reintentarse sin duplicar). */
export async function processWebhookEvent(webhookEventId: string) {
  const ev = await db.query.webhookEvents.findFirst({ where: eq(webhookEvents.id, webhookEventId) });
  if (!ev || !ev.tenantId) return;
  if (ev.status === "processed" || ev.status === "ignored") return;
  try {
    const p = ev.payload as CwWebhookMessage & CwWebhookConversation;
    let outcome = "ignored";
    switch (ev.event) {
      case "message_created":
        outcome = await handleMessageCreated(ev.tenantId, p);
        break;
      case "message_updated":
        outcome = await handleMessageUpdated(ev.tenantId, p);
        break;
      case "conversation_created":
      case "conversation_status_changed":
      case "conversation_updated":
        outcome = await handleConversationEvent(ev.tenantId, p);
        break;
    }
    await db
      .update(webhookEvents)
      .set({ status: outcome === "ignored" ? "ignored" : "processed", processedAt: new Date(), attempts: sql`${webhookEvents.attempts} + 1`, error: null })
      .where(eq(webhookEvents.id, ev.id));
  } catch (e) {
    await db.update(webhookEvents).set({ status: "failed", attempts: sql`${webhookEvents.attempts} + 1`, error: (e as Error).message.slice(0, 500) }).where(eq(webhookEvents.id, ev.id));
    throw e;
  }
}

const API_STATUS: Record<string, "sent" | "delivered" | "read" | "failed"> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

/** Concilia estados de entrega de mensajes salientes con la API de Chatwoot. */
export async function reconcileMessageStatuses(tenantId: string, conversationId: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)) });
  if (!conv) return;
  const { client } = await getTenantChatwoot(tenantId);
  const res = await client.listMessages(conv.chatwootConversationId);
  const outgoing = res.payload.filter((m: CwApiMessage) => m.message_type === 1 || m.message_type === 3);
  if (outgoing.length === 0) return;
  const locals = await db.query.messages.findMany({ where: and(eq(messages.tenantId, tenantId), inArray(messages.chatwootMessageId, outgoing.map((m) => m.id))) });
  for (const l of locals) {
    const remote = outgoing.find((m) => m.id === l.chatwootMessageId);
    const st = remote?.status ? API_STATUS[remote.status] : undefined;
    if (st && st !== l.status) {
      const err = st === "failed" ? String((remote?.content_attributes as { external_error?: string } | null)?.external_error ?? "Falló el envío") : null;
      await db.update(messages).set({ status: st, error: err, updatedAt: new Date() }).where(eq(messages.id, l.id));
    }
  }
}

/**
 * Reconciliación programada ante eventos perdidos: trae las conversaciones recientes de la
 * cuenta y crea/actualiza las faltantes (no reenvía nada a WhatsApp).
 */
export async function reconcileAccount(tenantId: string, pages = 2) {
  const { client } = await getTenantChatwoot(tenantId);
  let synced = 0;
  for (let page = 1; page <= pages; page++) {
    const res = await client.listConversations({ page });
    const list = res.data.payload;
    for (const conv of list) {
      await db.transaction(async (tx) => {
        const local = await upsertConversationFromChatwoot(tx, tenantId, conv);
        const last = conv.messages?.[0];
        if (last && (!local.lastMessageAt || last.created_at * 1000 > local.lastMessageAt.getTime())) {
          await tx
            .update(conversations)
            .set({
              lastMessageAt: new Date(last.created_at * 1000),
              lastMessagePreview: preview(last.content),
              lastMessageDirection: last.message_type === 0 ? "in" : "out",
              ...(last.message_type === 0 ? { lastIncomingAt: new Date(last.created_at * 1000) } : {}),
            })
            .where(eq(conversations.id, local.id));
        }
      });
      synced++;
    }
    if (list.length < 25) break;
  }
  log.info("chatwoot.reconcile_account", { tenantId, synced });
  return synced;
}
