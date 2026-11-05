/**
 * VALIDACIÓN CONTRA CHATWOOT CE REAL (no simulador). Opt-in: requiere una instancia de Chatwoot y el
 * token de una Platform App. Sin Meta: se usa una bandeja de tipo API (Channel::Api) para generar
 * mensajes entrantes; todo lo demás es el camino real: Platform API, webhook FIRMADO por Chatwoot,
 * receptor, cola, motor, API de mensajes y eco del webhook.
 *
 *   CHATWOOT_REAL_URL=http://localhost:3001 CHATWOOT_REAL_PLATFORM_TOKEN=… \
 *   CHATWOOT_REAL_WEBHOOK_TARGET=http://host.docker.internal:3013 \
 *   npx vitest run -c tests/audit/vitest.audit.config.mts tests/audit/chatwoot-real.audit.test.ts
 *
 * NO valida: WhatsApp Cloud API / Meta (bandeja WhatsApp, entregas, plantillas reales, ventana de 24 h de Meta).
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { chatwootAccounts, conversations, flowRuns, messages } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto/vault";
import { provisionChatwootAccount } from "@/server/services/chatwoot-provisioning";
import { createAiConnection } from "@/server/services/ai-connections";
import { createBot, publishBot, setBotStatus } from "@/server/services/bots";
import { sendOutbound } from "@/server/services/outbound";
import { twoTenants } from "../helpers/factory";
import { relayHits, settle, startWebhookRelay } from "../helpers/chatwoot";
import { decision, scriptedAi } from "../helpers/scripted-ai";

const REAL = process.env.CHATWOOT_REAL_URL;
const run = REAL && process.env.CHATWOOT_REAL_PLATFORM_TOKEN ? describe : describe.skip;
const results: { id: string; check: string; obtained: string; verdict: "PASS" | "FAIL" }[] = [];
const rec = (id: string, check: string, obtained: string, ok: boolean) => results.push({ id, check, obtained, verdict: ok ? "PASS" : "FAIL" });
const ai = scriptedAi(3017);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cw<T>(token: string, method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(`${REAL}${p}`, { method, headers: { api_access_token: token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return (t ? JSON.parse(t) : null) as T;
}

/** Espera a que el webhook real llegue y la cola lo procese. */
async function waitFor(cond: () => Promise<boolean>, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await settle(1500);
    if (await cond()) return true;
    await sleep(500);
  }
  return false;
}

beforeAll(async () => {
  if (!REAL) return;
  process.env.CHATWOOT_BASE_URL = REAL;
  process.env.CHATWOOT_PLATFORM_TOKEN = process.env.CHATWOOT_REAL_PLATFORM_TOKEN;
  process.env.CHATWOOT_WEBHOOK_TARGET_URL = process.env.CHATWOOT_REAL_WEBHOOK_TARGET ?? "http://host.docker.internal:3013";
  await startWebhookRelay();
  await ai.start();
});
afterAll(() => {
  ai.stop();
  if (!REAL) return;
  const out = path.resolve(import.meta.dirname, "../../docs/readiness-remediation/evidence");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "chatwoot-real-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), chatwoot: REAL, scope: "Chatwoot CE real con bandeja API (sin Meta)", results }, null, 2));
});

run("Chatwoot CE real (sin Meta)", () => {
  it("aprovisionamiento, webhook firmado, bot, ráfaga, toma humana y plantilla", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const version = await (await fetch(`${REAL}/api`)).json();
    rec("R0", "Versión de Chatwoot", JSON.stringify(version), version.version === "4.19.0");

    // 1) Platform API: cuenta + usuario de servicio + webhook con secreto
    await provisionChatwootAccount(A.id, null);
    const m = (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, A.id) }))!;
    const token = decryptSecret(m.apiTokenEnc, `cw:${A.id}`);
    const hooks = await cw<{ payload: { webhooks: { url: string; subscriptions: string[] }[] } }>(token, "GET", `/api/v1/accounts/${m.chatwootAccountId}/webhooks`);
    rec("R1", "Aprovisionamiento por Platform API: cuenta, usuario de servicio y webhook con secreto", `cuenta=${m.chatwootAccountId}; webhooks=${JSON.stringify(hooks.payload.webhooks.map((w) => w.url))}; secreto guardado=${Boolean(m.webhookSecretEnc)}`, hooks.payload.webhooks.length === 1 && Boolean(m.webhookSecretEnc));

    // 2) bandeja API (sustituye a WhatsApp, que requiere Meta) + bot
    const inbox = await cw<{ id: number }>(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/inboxes`, { name: "API audit", channel: { type: "api", webhook_url: "" } });
    const conn = await createAiConnection(ctxA, { provider: "openai_compatible", label: "Guionado", apiKey: "sk-tenant-key-REAL", baseUrl: ai.url, defaultModel: "gpt-4o-mini" });
    const bot = await createBot(ctxA, { name: "Real", mode: "instructions", aiConnectionId: conn.id, instructions: "Vendemos herramientas.", allowedTools: ["classify", "handoff"] as never, handoffKeywords: ["asesor"] });
    await publishBot(ctxA, bot.id);
    await setBotStatus(ctxA, bot.id, "active");

    // 3) mensaje entrante real → webhook firmado por Chatwoot → Loopchat → bot → API de mensajes de Chatwoot
    const contact = await cw<{ payload: { contact: { id: number }; contact_inbox: { source_id: string } } }>(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/contacts`, { inbox_id: inbox.id, name: "Cliente Real", phone_number: "+5491155550001" });
    const cv = await cw<{ id: number }>(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/conversations`, { source_id: contact.payload.contact_inbox.source_id, inbox_id: inbox.id, contact_id: contact.payload.contact.id });
    ai.push(decision({ reply: "¡Hola! Soy el asistente real." }));
    const hits0 = relayHits;
    const t0 = Date.now();
    await cw(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/conversations/${cv.id}/messages`, { content: "Hola, ¿tienen taladros?", message_type: "incoming" });
    const outOf = async () => (await cw<{ payload: { message_type: number; content: string; content_attributes?: Record<string, unknown> }[] }>(token, "GET", `/api/v1/accounts/${m.chatwootAccountId}/conversations/${cv.id}/messages`)).payload.filter((x) => x.message_type === 1);
    const replied = await waitFor(async () => (await outOf()).some((x) => x.content === "¡Hola! Soy el asistente real."));
    const local = await db.query.conversations.findFirst({ where: and(eq(conversations.tenantId, A.id), eq(conversations.chatwootConversationId, cv.id)) });
    rec("R2", "Webhook real firmado (HMAC de Chatwoot) aceptado y procesado", `webhooks recibidos=${relayHits - hits0}; conversación sincronizada=${Boolean(local)}`, relayHits - hits0 > 0 && Boolean(local));
    rec("R3", "Respuesta automática del bot publicada en Chatwoot por la API real", `respondió=${replied}; latencia ≈ ${Date.now() - t0} ms (incluye polling del test)`, replied);
    const echo = await waitFor(async () => Boolean(await db.query.messages.findFirst({ where: and(eq(messages.tenantId, A.id), eq(messages.senderKind, "bot"), eq(messages.status, "sent")) })), 15000);
    rec("R4", "Eco del webhook real concilia el mensaje del bot (estado enviado, id de Chatwoot)", `conciliado=${echo}`, echo);

    // 4) ráfaga: pedido de asesor mientras el bot procesa (IA lenta)
    ai.push({ content: decision({ reply: "RESPUESTA LENTA" }), delayMs: 2500 });
    await cw(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/conversations/${cv.id}/messages`, { content: "¿Y cuánto salen?", message_type: "incoming" });
    await sleep(800);
    await cw(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/conversations/${cv.id}/messages`, { content: "Mejor quiero hablar con un asesor", message_type: "incoming" });
    const handed = await waitFor(async () => (await db.query.conversations.findFirst({ where: eq(conversations.id, local!.id) }))?.attentionMode === "requested");
    await settle(5000);
    const late = (await outOf()).some((x) => x.content === "RESPUESTA LENTA");
    rec("R5", "Ráfaga real: el pedido de asesor deriva y la respuesta en curso no sale", `derivó=${handed}; respuesta tardía enviada=${late}`, handed && !late);

    // 5) toma humana desde Loopchat → sale por Chatwoot una sola vez
    await sendOutbound(ctxAgentA, { conversationId: local!.id, text: "Hola, te atiende Andrés.", idempotencyKey: `real-human-${local!.id}` });
    await sendOutbound(ctxAgentA, { conversationId: local!.id, text: "Hola, te atiende Andrés.", idempotencyKey: `real-human-${local!.id}` });
    const human = (await outOf()).filter((x) => x.content === "Hola, te atiende Andrés.");
    rec("R6", "Respuesta humana idempotente por la API real (doble envío con la misma clave)", `copias en Chatwoot=${human.length}`, human.length === 1);

    // 6) plantilla: Chatwoot guarda template_params en additional_attributes (contrato v4.19)
    await sendOutbound(ctxAgentA, { conversationId: local!.id, text: "Hola Ana, seguimos por acá.", idempotencyKey: `real-tpl-${local!.id}`, template: { name: "seguimiento_consulta", language: "es_AR", params: ["Ana", "taladros"] } });
    // el listado de mensajes no expone additional_attributes: se verifica en el payload del webhook real (eco)
    const { webhookEvents } = await import("@/server/db/schema");
    let tp: Record<string, unknown> | undefined;
    await waitFor(async () => {
      const evs = await db.select().from(webhookEvents).where(and(eq(webhookEvents.tenantId, A.id), eq(webhookEvents.event, "message_created")));
      const ev = evs.find((e) => (e.payload as { content?: string }).content === "Hola Ana, seguimos por acá.");
      tp = (ev?.payload as { additional_attributes?: { template_params?: Record<string, unknown> } } | undefined)?.additional_attributes?.template_params;
      return Boolean(tp);
    }, 15000);
    rec("R7", "template_params aceptado y guardado por Chatwoot real (verificado en el eco firmado; sin envío a Meta: bandeja API)", JSON.stringify(tp ?? null).slice(0, 200), tp?.name === "seguimiento_consulta" && (tp?.processed_params as { body?: Record<string, string> })?.body?.["2"] === "taladros");

    const runs = await db.select().from(flowRuns).where(eq(flowRuns.conversationId, local!.id));
    rec("R8", "Sin ejecuciones colgadas", runs.map((r) => r.status).join(","), runs.every((r) => !["queued", "running"].includes(r.status)));
    for (const r of results) console.log(r.verdict, r.id, r.check, "→", r.obtained);
    expect(results.filter((r) => r.verdict === "FAIL")).toEqual([]);
  }, 240000);

  it("carga moderada con Chatwoot real: 4 empresas × 6 conversaciones simultáneas (IA guionada 300 ms)", async () => {
    const tenants: { tenantId: string; token: string; acc: number; inbox: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const { A, ctxA } = await twoTenants();
      await provisionChatwootAccount(A.id, null);
      const m = (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, A.id) }))!;
      const token = decryptSecret(m.apiTokenEnc, `cw:${A.id}`);
      const inbox = await cw<{ id: number }>(token, "POST", `/api/v1/accounts/${m.chatwootAccountId}/inboxes`, { name: "API carga", channel: { type: "api", webhook_url: "" } });
      const conn = await createAiConnection(ctxA, { provider: "openai_compatible", label: "Guionado", apiKey: "sk-tenant-key-LOAD", baseUrl: ai.url, defaultModel: "gpt-4o-mini" });
      const bot = await createBot(ctxA, { name: "Carga", mode: "instructions", aiConnectionId: conn.id, instructions: "[CARGA] Vendemos.", allowedTools: ["classify"] as never, handoffKeywords: [] });
      await publishBot(ctxA, bot.id);
      await setBotStatus(ctxA, bot.id, "active");
      tenants.push({ tenantId: A.id, token, acc: m.chatwootAccountId, inbox: inbox.id });
    }
    ai.rules.push((c) => (c.system.includes("[CARGA]") ? { content: decision({ reply: "ok carga real" }), delayMs: 300 } : undefined));
    const convs: { t: (typeof tenants)[number]; id: number; at: number }[] = [];
    let n = 0;
    for (const t of tenants)
      for (let k = 0; k < 6; k++) {
        const c = await cw<{ payload: { contact: { id: number }; contact_inbox: { source_id: string } } }>(t.token, "POST", `/api/v1/accounts/${t.acc}/contacts`, { inbox_id: t.inbox, name: `Carga ${n}`, phone_number: `+54911666${String(n++).padStart(5, "0")}` });
        const cv = await cw<{ id: number }>(t.token, "POST", `/api/v1/accounts/${t.acc}/conversations`, { source_id: c.payload.contact_inbox.source_id, inbox_id: t.inbox, contact_id: c.payload.contact.id });
        convs.push({ t, id: cv.id, at: 0 });
      }
    const t0 = Date.now();
    await Promise.all(convs.map(async (c) => {
      c.at = Date.now();
      await cw(c.t.token, "POST", `/api/v1/accounts/${c.t.acc}/conversations/${c.id}/messages`, { content: "Hola, consulta de carga", message_type: "incoming" });
    }));
    const lat: number[] = [];
    const pending = new Set(convs);
    while (pending.size && Date.now() - t0 < 120000) {
      await settle(800);
      for (const c of [...pending]) {
        const msgs = await cw<{ payload: { message_type: number; content: string }[] }>(c.t.token, "GET", `/api/v1/accounts/${c.t.acc}/conversations/${c.id}/messages`);
        if (msgs.payload.some((x) => x.message_type === 1 && x.content === "ok carga real")) {
          lat.push(Date.now() - c.at);
          pending.delete(c);
        }
      }
    }
    lat.sort((a, b) => a - b);
    const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
    rec("R9", "Carga con Chatwoot real: 24 mensajes simultáneos en 4 empresas, respuesta del bot publicada en Chatwoot", `respondidas=${lat.length}/24; total=${Date.now() - t0} ms; mensaje→respuesta p50=${p(0.5)} ms p95=${p(0.95)} ms máx=${lat.at(-1)} ms (incluye polling del test ~1 s)`, lat.length === 24);
    expect(lat.length).toBe(24);
  }, 300000);
});
