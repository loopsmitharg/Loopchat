import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db";
import { botTransfers, chatwootAccounts, conversations, tenants } from "../src/server/db/schema";
import { decryptSecret } from "../src/server/crypto/vault";
import { TENANT } from "./lib/todo-trabajo-data";

/**
 * Prueba de humo E2E con Chatwoot REAL y la app/worker EN EJECUCIÓN (no usa la cola en proceso):
 * bandeja API de Chatwoot (sustituye a WhatsApp, que requiere Meta) → webhook firmado hacia la URL
 * PÚBLICA de Loopchat (túnel) → worker → equipo de Todo Trabajo → respuesta publicada en Chatwoot.
 * Uso: npx tsx --conditions=react-server scripts/smoke-chatwoot-todo-trabajo.ts ["mensaje"]
 */
const message = process.argv[2] ?? "Quiero hablar con una persona.";

async function main() {
  const db = getDb();
  const base = process.env.CHATWOOT_BASE_URL!;
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, TENANT.slug) });
  const map = t && (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, t.id) }));
  if (!t || !map) throw new Error("Todo Trabajo no tiene cuenta de Chatwoot: ejecutá scripts/setup-todo-trabajo.ts");
  const token = decryptSecret(map.apiTokenEnc, `cw:${t.id}`);
  const acc = `/api/v1/accounts/${map.chatwootAccountId}`;
  const cw = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${acc}${p}`, { method, headers: { "api-access-token": token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${txt.slice(0, 200)}`);
    return (txt ? JSON.parse(txt) : null) as T;
  };
  const inboxes = await cw<{ payload: { id: number; name: string }[] }>("GET", "/inboxes");
  const inbox = inboxes.payload.find((i) => i.name === "Prueba Loopchat (API, sin Meta)") ?? (await cw<{ id: number }>("POST", "/inboxes", { name: "Prueba Loopchat (API, sin Meta)", channel: { type: "api", webhook_url: "" } }));
  const phone = `+54911555${String(Date.now()).slice(-5)}`;
  const contact = await cw<{ payload: { contact: { id: number }; contact_inbox: { source_id: string } } }>("POST", "/contacts", { inbox_id: inbox.id, name: "Prueba local (smoke)", phone_number: phone });
  const conv = await cw<{ id: number }>("POST", "/conversations", { source_id: contact.payload.contact_inbox.source_id, inbox_id: inbox.id, contact_id: contact.payload.contact.id });
  const t0 = Date.now();
  await cw("POST", `/conversations/${conv.id}/messages`, { content: message, message_type: "incoming" });
  let local: typeof conversations.$inferSelect | undefined;
  let out: { content: string }[] = [];
  while (Date.now() - t0 < 45000) {
    await new Promise((r) => setTimeout(r, 1500));
    local = await db.query.conversations.findFirst({ where: and(eq(conversations.tenantId, t.id), eq(conversations.chatwootConversationId, conv.id)) });
    out = (await cw<{ payload: { message_type: number; content: string }[] }>("GET", `/conversations/${conv.id}/messages`)).payload.filter((m) => m.message_type === 1);
    if (local && out.length) break;
  }
  const transfers = local ? await db.select({ kind: botTransfers.kind, reason: botTransfers.reason }).from(botTransfers).where(eq(botTransfers.conversationId, local.id)).orderBy(desc(botTransfers.createdAt)) : [];
  const res = {
    message,
    chatwootConversation: conv.id,
    syncedInLoopchat: Boolean(local),
    attentionMode: local?.attentionMode ?? null,
    teamPinned: Boolean(local?.teamId),
    transfers,
    replyInChatwoot: out.map((m) => m.content),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(res, null, 2));
  await getPool().end();
  if (!res.syncedInLoopchat || !res.replyInChatwoot.length) process.exit(1);
}
main().catch(async (e) => {
  console.error(e);
  await getPool().end().catch(() => {});
  process.exit(1);
});
