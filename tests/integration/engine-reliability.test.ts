import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { conversations, flowRuns, jobs, opportunities, stages, tasks, usageEvents } from "@/server/db/schema";
import { createAiConnection } from "@/server/services/ai-connections";
import { createBot, publishBot, setBotStatus } from "@/server/services/bots";
import { sendOutbound } from "@/server/services/outbound";
import { triggerBotForIncoming } from "@/server/flows/trigger";
import { executeRunJob, recoverAbandonedRuns } from "@/server/flows/runtime";
import { claimJobs, completeJob, enqueue } from "@/server/jobs/queue";
import type { Ctx } from "@/server/authz/context";
import { twoTenants } from "../helpers/factory";
import { localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";
import { decision, scriptedAi } from "../helpers/scripted-ai";

const ai = scriptedAi(3015);
beforeAll(async () => {
  await startWebhookRelay();
  await ai.start();
});
afterAll(() => ai.stop());
beforeEach(() => ai.reset());

let seq = 0;
const phone = () => `+54911${String(Date.now()).slice(-5)}${String(seq++).padStart(3, "0")}`;
const outgoing = async (acc: number, cw: number) => (await simMessages(acc, cw)).filter((m) => m.message_type === 1).map((m) => m.content);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(ctx: Ctx, opts: { tools?: string[]; instructions?: string; config?: Record<string, unknown> } = {}) {
  const conn = await createAiConnection(ctx, { provider: "openai_compatible", label: "Guionado", apiKey: "sk-tenant-key-RELI", baseUrl: ai.url, defaultModel: "gpt-4o-mini" });
  const bot = await createBot(ctx, {
    name: "Vendedor",
    mode: "instructions",
    aiConnectionId: conn.id,
    instructions: opts.instructions ?? "Vendemos herramientas.",
    allowedTools: (opts.tools ?? ["classify", "handoff", "create_opportunity", "update_stage", "create_task"]) as never,
    handoffKeywords: ["asesor"],
    ...(opts.config ? { config: opts.config as never } : {}),
  });
  await publishBot(ctx, bot.id);
  await setBotStatus(ctx, bot.id, "active");
  return bot;
}

describe("mensajes en ráfaga (regresión P0-02 / S24)", () => {
  it("pedido de asesor mientras la IA procesa: deriva ya, cancela la respuesta en curso y no pierde el mensaje", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    ai.push({ content: decision({ reply: "RESPUESTA LENTA del bot" }), delayMs: 1500 });
    const ph = phone();
    const r1 = await simIncoming(accountId, { phone: ph, content: "Hola, quiero consultar por un producto." });
    const draining = settle(10000);
    await sleep(500);
    await simIncoming(accountId, { phone: ph, content: "Quiero hablar con un asesor." });
    await draining;
    await settle();
    const conv = (await localConversation(A.id, r1.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    expect(conv.pendingBotMessage).toBeNull();
    expect(await outgoing(accountId, r1.conversationId)).not.toContain("RESPUESTA LENTA del bot");
    const runs = await db.select().from(flowRuns).where(eq(flowRuns.conversationId, conv.id));
    expect(runs.map((r) => r.status).sort()).toEqual(["cancelled", "handed_off"]);
    expect(runs.find((r) => r.status === "handed_off")?.metrics).toMatchObject({ handoffCode: "keyword", aiCalls: 0 });
  });

  it("insulto mientras la IA procesa: deriva sin IA", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    ai.push({ content: decision({ reply: "lenta" }), delayMs: 1200 });
    const ph = phone();
    const r1 = await simIncoming(accountId, { phone: ph, content: "hola" });
    const draining = settle(10000);
    await sleep(400);
    await simIncoming(accountId, { phone: ph, content: "sos un idiota" });
    await draining;
    expect((await localConversation(A.id, r1.conversationId))!.attentionMode).toBe("requested");
    expect(ai.calls).toHaveLength(1);
  });

  it("segunda consulta mientras la IA procesa: se responde después, con el mensaje nuevo y el historial", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    ai.push({ content: decision({ reply: "Respuesta 1" }), delayMs: 1000 }, decision({ reply: "Respuesta 2" }));
    const ph = phone();
    const r1 = await simIncoming(accountId, { phone: ph, content: "Busco un taladro" });
    const draining = settle(10000);
    await sleep(400);
    await simIncoming(accountId, { phone: ph, content: "¿Y también tienen amoladoras?" });
    await draining;
    await settle();
    expect(await outgoing(accountId, r1.conversationId)).toEqual(["Respuesta 1", "Respuesta 2"]);
    expect(ai.calls).toHaveLength(2);
    expect(ai.lastUser(1)).toBe("¿Y también tienen amoladoras?");
    const conv = (await localConversation(A.id, r1.conversationId))!;
    expect(conv.pendingBotMessage).toBeNull();
  });

  it("disparos concurrentes y fuera de orden: una sola ejecución activa; un mensaje viejo no pisa uno nuevo", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    const r = await simIncoming(accountId, { phone: phone(), content: "hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const base = 9_000_000 + Math.floor(Math.random() * 1e5);
    const res = await Promise.all([3, 1, 2].map((k) => triggerBotForIncoming({ tenantId: A.id, conversationId: conv.id, chatwootMessageId: base + k, text: `msg ${k}` })));
    const active = await db.select().from(flowRuns).where(and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])));
    expect(active).toHaveLength(1);
    expect(res.filter((x) => x.started)).toHaveLength(1);
    // el pendiente (si quedó) es el más nuevo de los no iniciados; un mensaje más viejo que el activo se descarta
    const after = (await localConversation(A.id, r.conversationId))!;
    const activeMsg = Number(active[0].triggerKey.split(":")[1]);
    if (after.pendingBotMessage) expect(after.pendingBotMessage.chatwootMessageId).toBeGreaterThan(activeMsg);
    await settle();
    expect(await db.select().from(flowRuns).where(and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])))).toHaveLength(0);
  });
});

describe("worker concurrente con leases (regresión P0-03 / P2-05 / S48)", () => {
  it("la empresa B no espera detrás de llamadas lentas de la empresa A", async () => {
    const a = await twoTenants();
    const b = await twoTenants();
    const pa = await provisionWithChannel(a.ctxA);
    const pb = await provisionWithChannel(b.ctxA);
    await setup(a.ctxA, { instructions: "[LENTO] Vendemos." });
    await setup(b.ctxA, { instructions: "[RAPIDO] Vendemos." });
    ai.rules.push((c) => (c.system.includes("[LENTO]") ? { content: decision({ reply: "lento" }), delayMs: 1500 } : undefined));
    for (let i = 0; i < 4; i++) await simIncoming(pa.accountId, { phone: phone(), content: "consulta lenta" });
    const t0 = Date.now();
    const rb = await simIncoming(pb.accountId, { phone: phone(), content: "consulta rápida" });
    const draining = settle(20000);
    let waited = -1;
    while (Date.now() - t0 < 15000) {
      if ((await outgoing(pb.accountId, rb.conversationId)).length) {
        waited = Date.now() - t0;
        break;
      }
      await sleep(50);
    }
    await draining;
    expect(waited).toBeGreaterThanOrEqual(0);
    expect(waited).toBeLessThan(1500);
  });

  it("dos workers no ejecutan la misma ejecución a la vez (una sola llamada a la IA)", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const bot = await setup(ctxA);
    const r = await simIncoming(accountId, { phone: phone(), content: "hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const published = (await db.query.bots.findFirst({ where: (t, { eq }) => eq(t.id, bot.id) }))!.publishedVersionId!;
    const [run] = await db.insert(flowRuns).values({ tenantId: A.id, botId: bot.id, versionId: published, conversationId: conv.id, triggerKey: `msg:${Date.now()}`, status: "queued", context: { lastMessage: "otra consulta", vars: {} } }).returning();
    ai.reset();
    ai.push({ content: decision({ reply: "una sola" }), delayMs: 600 });
    const job = { runId: run.id, mode: "start" as const, message: "otra consulta" };
    const res = await Promise.all([executeRunJob(job, 1, 3, { owner: "w1" }), executeRunJob(job, 1, 3, { owner: "w2" })]);
    expect(res.filter((x) => x.skipped)).toHaveLength(1);
    expect(ai.calls).toHaveLength(1);
    expect((await outgoing(accountId, r.conversationId)).filter((t) => t === "una sola")).toHaveLength(1);
  });

  it("fencing: un worker cuyo lease venció no puede cerrar el trabajo retomado por otro", async () => {
    const { A } = await twoTenants();
    await enqueue("chatwoot.reconcile_status", { conversationId: "00000000-0000-4000-8000-000000000000" }, { tenantId: A.id, dedupKey: `fence:${A.id}` });
    const [j1] = (await claimJobs("worker-1", 50, { lockSeconds: 1, perTenant: 50 })).filter((j) => j.tenantId === A.id);
    expect(j1).toBeTruthy();
    await sleep(1300);
    const [j2] = (await claimJobs("worker-2", 50, { lockSeconds: 30, perTenant: 50 })).filter((j) => j.id === j1.id);
    expect(j2?.id).toBe(j1.id);
    expect(await completeJob(j1)).toBe(false);
    expect(await completeJob(j2)).toBe(true);
  });

  it("ejecución abandonada (proceso caído) se recupera y la conversación vuelve a atenderse", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    const r = await simIncoming(accountId, { phone: phone(), content: "hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const prev = (await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) }))!;
    await db.insert(flowRuns).values({ tenantId: A.id, botId: prev.botId, versionId: prev.versionId, conversationId: conv.id, triggerKey: `msg:abandoned-${conv.id}`, status: "running", leaseOwner: "muerto", leaseUntil: new Date(Date.now() - 3600_000) });
    expect((await triggerBotForIncoming({ tenantId: A.id, conversationId: conv.id, chatwootMessageId: 8_000_001, text: "sigo acá" })).reason).toBe("pending");
    expect(await recoverAbandonedRuns(60)).toBeGreaterThanOrEqual(1);
    await settle();
    expect(ai.lastUser()).toBe("sigo acá");
  });
});

describe("idempotencia y autoridad del bot (regresión P1-02 / P1-03 / P2-04)", () => {
  it("falla de Chatwoot al enviar: 1 respuesta, 1 tarea y 1 llamada de IA facturada", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    ai.push(decision({ reply: "Te llamamos.", task: { title: "Llamar al cliente", due_in_hours: 24 } }), decision({ reply: "Te llamamos (2).", task: { title: "Llamar al cliente", due_in_hours: 24 } }));
    const r = await simIncoming(accountId, { phone: phone(), content: "llamame" });
    await fetch("http://localhost:3011/__sim/fail-next-send", { method: "POST" });
    await settle(4000);
    await sleep(5500);
    await settle(6000);
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(await outgoing(accountId, r.conversationId)).toEqual(["Te llamamos."]);
    expect(await db.select().from(tasks).where(eq(tasks.contactId, conv.contactId))).toHaveLength(1);
    expect(ai.calls).toHaveLength(1);
    expect(await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, A.id), eq(usageEvents.metric, "ai_calls")))).toHaveLength(1);
  });

  it("toma humana durante la IA: no sale la respuesta y no se aplican efectos CRM", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    ai.push({ content: decision({ reply: "Respuesta TARDÍA", task: { title: "Tarea tardía", due_in_hours: 24 }, opportunity: { title: "Interés tardío", amount: 1000 } }), delayMs: 1500 });
    const r = await simIncoming(accountId, { phone: phone(), content: "Necesito un presupuesto" });
    const draining = settle(10000);
    await sleep(600);
    const conv = (await localConversation(A.id, r.conversationId))!;
    await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Hola, te atiendo yo", idempotencyKey: `manual:${conv.id}:1` });
    await draining;
    expect(await outgoing(accountId, r.conversationId)).toEqual(["Hola, te atiendo yo"]);
    expect(await db.select().from(tasks).where(eq(tasks.contactId, conv.contactId))).toHaveLength(0);
    expect(await db.select().from(opportunities).where(and(eq(opportunities.contactId, conv.contactId), eq(opportunities.title, "Interés tardío")))).toHaveLength(0);
    expect((await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) }))?.status).toBe("cancelled");
  });

  it("cotización sin permiso de etapas no mueve la oportunidad", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const st = await db.select().from(stages).where(eq(stages.tenantId, A.id));
    const cotizado = st.find((s) => s.name === "Cotizado")!;
    await setup(ctxA, { tools: ["classify", "handoff", "create_opportunity"], config: { pipeline: { quoteStageId: cotizado.id } } });
    const ph = phone();
    ai.push(decision({ reply: "Genial", intent: "compra", opportunity: { title: "Taladro", amount: null } }), decision({ reply: "Te cotizo", quote: true }));
    const r = await simIncoming(accountId, { phone: ph, content: "quiero comprar un taladro" });
    await settle();
    await simIncoming(accountId, { phone: ph, content: "pasame una cotización" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const [o] = await db.select().from(opportunities).where(eq(opportunities.contactId, conv.contactId));
    expect(o).toBeTruthy();
    expect(o.stageId).not.toBe(cotizado.id);
  });

  it("límite por contacto: no puede generar consumo ilimitado", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA, { config: { operation: { maxAiCallsPerConversation: 0, maxAiCallsPerContactPerDay: 3 } } });
    const ph = phone();
    let r!: { conversationId: number };
    for (let i = 0; i < 5; i++) {
      r = await simIncoming(accountId, { phone: ph, content: `consulta ${i}` });
      await settle();
    }
    expect(ai.calls.length).toBeLessThanOrEqual(3);
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("requested");
    void sql;
    void conversations;
  });
});
