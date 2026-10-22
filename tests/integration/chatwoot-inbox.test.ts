import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { chatwootAccounts, contacts, internalNotes, messages, opportunities, webhookEvents } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto/vault";
import { receiveChatwootWebhook } from "@/server/chatwoot/receive";
import { signChatwootPayload, verifyChatwootSignature } from "@/server/chatwoot/webhook";
import { addNote } from "@/server/services/notes";
import { assignConversation, getConversationDetail, listConversations, setAttentionMode, setConversationStatus } from "@/server/services/conversations";
import { retryOutbound, sendOutbound } from "@/server/services/outbound";
import { listChannels } from "@/server/services/channels";
import { addMember, ctxFor, twoTenants } from "../helpers/factory";
import { localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});

describe("firma de webhooks Chatwoot", () => {
  it("acepta firma válida y rechaza inválida/vencida/ausente", () => {
    const body = JSON.stringify({ event: "message_created" });
    const h = signChatwootPayload("secreto", body);
    expect(verifyChatwootSignature({ secret: "secreto", rawBody: body, signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"] }).ok).toBe(true);
    expect(verifyChatwootSignature({ secret: "otro", rawBody: body, signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"] }).ok).toBe(false);
    expect(verifyChatwootSignature({ secret: "secreto", rawBody: body + " ", signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"] }).ok).toBe(false);
    const old = signChatwootPayload("secreto", body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyChatwootSignature({ secret: "secreto", rawBody: body, signature: old["X-Chatwoot-Signature"], timestamp: old["X-Chatwoot-Timestamp"] })).toMatchObject({ ok: false, reason: "stale_timestamp" });
    expect(verifyChatwootSignature({ secret: "secreto", rawBody: body, signature: null, timestamp: null }).ok).toBe(false);
  });
});

describe("conector Chatwoot + bandeja (contra simulador de contrato)", () => {
  it("aprovisiona cuenta por tenant, recibe mensaje entrante sin duplicar y crea contacto/oportunidad", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId, channel } = await provisionWithChannel(ctxA);
    expect(channel.status).toBe("connected");
    expect(JSON.stringify(await listChannels(ctxA))).not.toContain("EAAtest-token");

    const r = await simIncoming(accountId, { phone: "+5491166660001", name: "Lucía Pérez", content: "Hola, tienen taladros?", duplicateDelivery: true });
    await settle();
    const conv = await localConversation(A.id, r.conversationId);
    expect(conv).toBeTruthy();
    expect(conv!.lastMessagePreview).toContain("taladros");
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(msgs.filter((m) => m.direction === "in")).toHaveLength(1); // la entrega duplicada no duplica
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv!.contactId) });
    expect(contact?.phoneE164).toBe("+5491166660001");
    const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, contact!.id)) });
    expect(opp?.status).toBe("open");
  });

  it("reenvío del mismo webhook (mismo delivery id) se ignora y firma inválida se rechaza", async () => {
    const { A, ctxA } = await twoTenants();
    await provisionWithChannel(ctxA);
    const mapping = (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, A.id) }))!;
    const secret = decryptSecret(mapping.webhookSecretEnc!, `cwwh:${A.id}`);
    const body = JSON.stringify({ event: "conversation_updated", account: { id: mapping.chatwootAccountId }, id: 999, inbox_id: 1, status: "open", meta: { sender: { id: 1, name: "X", phone_number: "+5491100000000" } } });
    const h = signChatwootPayload(secret, body);
    const first = await receiveChatwootWebhook({ key: mapping.webhookKey, rawBody: body, signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"], deliveryId: "d-1" });
    const again = await receiveChatwootWebhook({ key: mapping.webhookKey, rawBody: body, signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"], deliveryId: "d-1" });
    expect(first.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true });
    const bad = await receiveChatwootWebhook({ key: mapping.webhookKey, rawBody: body, signature: "sha256=00", timestamp: h["X-Chatwoot-Timestamp"], deliveryId: "d-2" });
    expect(bad.status).toBe(401);
    expect(await db.select().from(webhookEvents).where(eq(webhookEvents.dedupKey, `cw:${mapping.chatwootAccountId}:d:d-2`))).toHaveLength(0);
  });

  it("evento de otra cuenta Chatwoot firmado con el secreto de A es rechazado (cuenta cruzada)", async () => {
    const { A, ctxA } = await twoTenants();
    await provisionWithChannel(ctxA);
    const mapping = (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, A.id) }))!;
    const secret = decryptSecret(mapping.webhookSecretEnc!, `cwwh:${A.id}`);
    const body = JSON.stringify({ event: "message_created", account: { id: mapping.chatwootAccountId + 9999 }, id: 1 });
    const h = signChatwootPayload(secret, body);
    const res = await receiveChatwootWebhook({ key: mapping.webhookKey, rawBody: body, signature: h["X-Chatwoot-Signature"], timestamp: h["X-Chatwoot-Timestamp"], deliveryId: "x" });
    expect(res.status).toBe(403);
    expect((await receiveChatwootWebhook({ key: "no-existe", rawBody: body, signature: null, timestamp: null, deliveryId: null })).status).toBe(404);
  });

  it("respuesta desde Loopchat llega a Chatwoot una sola vez; nota interna nunca sale; B no ve nada de A", async () => {
    const { A, ctxA, ctxAgentA, agentA, ctxB } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660002", name: "Marcos", content: "Precio del cemento?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await setAttentionMode(ctxA, conv.id, { mode: "human" });

    const key = `ui-${Date.now()}-abc`;
    const sent = await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Hola Marcos, la bolsa está $9.500", idempotencyKey: key });
    expect(sent.status).toBe("sent");
    const dup = await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Hola Marcos, la bolsa está $9.500", idempotencyKey: key });
    expect(dup.duplicate).toBe(true);
    await addNote(ctxAgentA, { conversationId: conv.id, body: "Cliente frecuente, ofrecer envío" });
    await settle();

    const remote = await simMessages(accountId, r.conversationId);
    expect(remote.filter((m) => m.message_type === 1)).toHaveLength(1);
    expect(remote.some((m) => (m.content ?? "").includes("envío"))).toBe(false);
    const local = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(local.filter((m) => m.direction === "out")).toHaveLength(1); // el eco del webhook no duplica
    expect(local.find((m) => m.direction === "out")?.pendingContent).toBeNull();

    // el agente quedó como responsable al responder
    const detail = await getConversationDetail(ctxA, conv.id);
    expect(detail.conversation.assigneeUserId).toBe(agentA.id);
    expect(detail.thread.map((t) => t.content)).toContain("Hola Marcos, la bolsa está $9.500");
    expect(detail.notes[0].body).toContain("frecuente");

    await expect(getConversationDetail(ctxB, conv.id)).rejects.toThrow(/no encontrada/i);
    await expect(sendOutbound(ctxB, { conversationId: conv.id, text: "hack", idempotencyKey: `b-${Date.now()}-xyz` })).rejects.toThrow(/no encontrada/i);
    await expect(addNote(ctxB, { conversationId: conv.id, body: "x" })).rejects.toThrow(/No encontrado/);
    expect((await listConversations(ctxB, { status: "all" })).items).toHaveLength(0);
  });

  it("un solo responsable: otro agente no puede responder ni tomar una conversación asignada", async () => {
    const { A, ctxA, ctxAgentA, agentA } = await twoTenants();
    const agent2 = await addMember(A.id, "agent", "Segundo Agente");
    const ctxAgent2 = ctxFor(A.id, agent2, "agent");
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660003", content: "Hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await assignConversation(ctxAgentA, conv.id, { assigneeUserId: agentA.id });
    await expect(assignConversation(ctxAgent2, conv.id, { assigneeUserId: agent2.id })).rejects.toThrow(/responsable/);
    await expect(sendOutbound(ctxAgent2, { conversationId: conv.id, text: "Hola", idempotencyKey: `a2-${Date.now()}-xx` })).rejects.toThrow(/otro responsable/);
    // manager/admin puede reasignar
    await assignConversation(ctxA, conv.id, { assigneeUserId: agent2.id });
    expect((await getConversationDetail(ctxA, conv.id)).conversation.assigneeUserId).toBe(agent2.id);
    // agente no puede asignar a otro
    await expect(assignConversation(ctxAgentA, conv.id, { assigneeUserId: agentA.id })).rejects.toThrow();
  });

  it("fuera de la ventana de 24 h se bloquea el mensaje libre con explicación", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660004", content: "Consulta vieja", ageSeconds: 26 * 3600 });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await expect(sendOutbound(ctxA, { conversationId: conv.id, text: "Hola", idempotencyKey: `w-${Date.now()}-xx` })).rejects.toThrow(/24 h/);
    const detail = await getConversationDetail(ctxA, conv.id);
    expect(detail.window.open).toBe(false);
  });

  it("falla de envío se muestra y el reintento no duplica", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660005", content: "Hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await fetch("http://localhost:3011/__sim/fail-next-send", { method: "POST" });
    let failedId = "";
    try {
      await sendOutbound(ctxA, { conversationId: conv.id, text: "Respuesta importante", idempotencyKey: `f-${Date.now()}-xx` });
    } catch (e) {
      failedId = (e as { details?: { messageId: string } }).details!.messageId;
    }
    expect(failedId).toBeTruthy();
    const d1 = await getConversationDetail(ctxA, conv.id);
    expect(d1.thread.find((t) => t.localId === failedId)).toMatchObject({ status: "failed", retryable: true, content: "Respuesta importante" });
    await retryOutbound(ctxA, failedId);
    await settle();
    const remote = await simMessages(accountId, r.conversationId);
    expect(remote.filter((m) => m.content === "Respuesta importante")).toHaveLength(1);
  });

  it("estado de entrega se concilia desde la API; fallo de Meta se refleja", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660006", content: "Hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const sent = await sendOutbound(ctxA, { conversationId: conv.id, text: "Te confirmo", idempotencyKey: `s-${Date.now()}-xx` });
    await settle();
    const m = (await db.query.messages.findFirst({ where: eq(messages.id, sent.messageId) }))!;
    await fetch("http://localhost:3011/__sim/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, messageId: m.chatwootMessageId, status: "delivered" }) });
    await settle();
    expect((await db.query.messages.findFirst({ where: eq(messages.id, sent.messageId) }))!.status).toBe("delivered");
    await fetch("http://localhost:3011/__sim/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, messageId: m.chatwootMessageId, status: "failed", error: "Recipient not on WhatsApp" }) });
    await settle();
    const after = (await db.query.messages.findFirst({ where: eq(messages.id, sent.messageId) }))!;
    expect(after.status).toBe("failed");
    expect(after.error).toContain("Recipient");
  });

  it("cambio de estado se refleja en Chatwoot y localmente", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491166660007", content: "Gracias!" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await setConversationStatus(ctxA, conv.id, "resolved");
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.status).toBe("resolved");
    const notes = await db.select().from(internalNotes).where(eq(internalNotes.tenantId, A.id));
    expect(notes).toHaveLength(0);
  });
});
