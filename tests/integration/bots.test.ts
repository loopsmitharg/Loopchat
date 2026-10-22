import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FlowGraph } from "@/lib/flow/types";
import { db } from "@/server/db";
import { aiProviderConnections, conversations, flowRuns, opportunities, stages, subscriptions, tasks, usageCounters } from "@/server/db/schema";
import { createAiConnection, listAiConnections, revokeAiConnection, testAiConnection } from "@/server/services/ai-connections";
import { createBot, getBot, publishBot, saveDraft, setBotStatus, updateBotSettings } from "@/server/services/bots";
import { simulateBot } from "@/server/services/simulate";
import { setAttentionMode } from "@/server/services/conversations";
import { sendOutbound } from "@/server/services/outbound";
import { changeSubscription } from "@/server/services/plans";
import { addFaq } from "@/server/services/knowledge";
import { currentPeriod } from "@/server/services/usage";
import type { Ctx } from "@/server/authz/context";
import { twoTenants } from "../helpers/factory";
import { aiSim, localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});
beforeEach(async () => {
  await aiSim.reset();
});

async function setupBot(ctx: Ctx, opts: { provider?: "openai_compatible" | "anthropic" | "gemini"; key?: string; instructions?: string } = {}) {
  const provider = opts.provider ?? "openai_compatible";
  const conn = await createAiConnection(ctx, {
    provider,
    label: "Principal",
    apiKey: opts.key ?? "sk-tenant-key-AAAA",
    baseUrl: provider === "openai_compatible" ? "http://localhost:3012/v1" : undefined,
    defaultModel: provider === "anthropic" ? "claude-haiku-4-5" : provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini",
  });
  const bot = await createBot(ctx, { name: "Asistente", mode: "instructions", aiConnectionId: conn.id, instructions: opts.instructions ?? "Vendemos herramientas.", allowedTools: ["classify", "use_knowledge", "handoff", "create_opportunity", "update_stage", "create_task"], handoffKeywords: ["asesor"] });
  await publishBot(ctx, bot.id);
  await setBotStatus(ctx, bot.id, "active");
  return { conn, bot };
}

describe("conexiones de IA (BYOK)", () => {
  it("la clave se guarda cifrada, nunca se devuelve, y A/B usan credenciales distintas", async () => {
    const { ctxA, ctxB } = await twoTenants();
    const a = await createAiConnection(ctxA, { provider: "openai_compatible", label: "OpenAI A", apiKey: "sk-empresa-a-1111", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
    const b = await createAiConnection(ctxB, { provider: "anthropic", label: "Claude B", apiKey: "sk-ant-empresa-b-2222", defaultModel: "claude-haiku-4-5" });
    expect(JSON.stringify([a, ...(await listAiConnections(ctxA))])).not.toContain("sk-empresa-a-1111");
    const raw = await db.query.aiProviderConnections.findFirst({ where: eq(aiProviderConnections.id, a.id) });
    expect(raw!.apiKeyEnc).not.toContain("1111");
    expect((await testAiConnection(ctxA, a.id)).status).toBe("verified");
    expect((await testAiConnection(ctxB, b.id)).status).toBe("verified");
    const reqs = await aiSim.requests();
    expect(reqs.find((r) => r.provider === "openai_compatible")!.keyTail).toBe("1111");
    expect(reqs.find((r) => r.provider === "anthropic")!.keyTail).toBe("2222");
    // B no puede usar ni probar la conexión de A
    await expect(testAiConnection(ctxB, a.id)).rejects.toThrow(/No encontrado/);
    expect(await listAiConnections(ctxB)).toHaveLength(1);
  });

  it("clave inválida queda en error con mensaje claro; revocar la inutiliza", async () => {
    const { ctxA } = await twoTenants();
    const c = await createAiConnection(ctxA, { provider: "gemini", label: "Gemini", apiKey: "sk-bad-gemini-key", defaultModel: "gemini-2.5-flash" });
    const t = await testAiConnection(ctxA, c.id);
    expect(t.status).toBe("error");
    expect(t.lastError).toMatch(/rechazada/);
    await revokeAiConnection(ctxA, c.id);
    expect((await listAiConnections(ctxA))[0].keyHint).toBe("revocada");
  });

  it("agente no puede gestionar credenciales; URL privada se rechaza fuera de dev", async () => {
    const { ctxAgentA, ctxA } = await twoTenants();
    await expect(createAiConnection(ctxAgentA, { provider: "openai_compatible", label: "Interno", apiKey: "sk-xxxxxxxxxx", defaultModel: "gpt-4" })).rejects.toThrow(/permiso/);
    const prev = process.env.LOOPCHAT_ALLOW_PRIVATE_URLS;
    process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = "false";
    try {
      await expect(createAiConnection(ctxA, { provider: "openai_compatible", label: "Interno", apiKey: "sk-xxxxxxxxxx", baseUrl: "http://169.254.169.254/latest", defaultModel: "gpt-4" })).rejects.toThrow(/https/);
      await expect(createAiConnection(ctxA, { provider: "openai_compatible", label: "Interno", apiKey: "sk-xxxxxxxxxx", baseUrl: "https://10.0.0.5/v1", defaultModel: "gpt-4" })).rejects.toThrow(/privada/);
    } finally {
      process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = prev;
    }
  });
});

describe("bot básico con transferencia humana (runtime real contra simuladores)", () => {
  it("mensaje → respuesta del bot vía Chatwoot con trazabilidad; precio crea oportunidad y mueve etapa", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setupBot(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491177770001", name: "Sofía", content: "Hola, cuál es el precio del taladro?" });
    await settle();
    const remote = await simMessages(accountId, r.conversationId);
    const botMsg = remote.find((m) => m.message_type === 1);
    expect(botMsg?.content).toContain("85.000");
    const conv = (await localConversation(A.id, r.conversationId))!;
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect(run).toMatchObject({ status: "completed", botId: bot.id });
    const local = await db.query.messages.findFirst({ where: (m, { and, eq }) => and(eq(m.conversationId, conv.id), eq(m.senderKind, "bot")) });
    expect(local?.origin).toMatchObject({ botId: bot.id, runId: run!.id });
    const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.conversationId, conv.id)) });
    const stage = await db.query.stages.findFirst({ where: eq(stages.id, opp!.stageId) });
    expect(stage?.name).toBe("Cotizado");
    expect(Number(opp!.amount)).toBe(85000);
    const counter = await db.query.usageCounters.findFirst({ where: and(eq(usageCounters.tenantId, A.id), eq(usageCounters.period, currentPeriod()), eq(usageCounters.metric, "ai_calls")) });
    expect(counter?.value).toBe(1);
  });

  it("pedido de humano: el bot transfiere, deja de responder, y solo se reanuda por acción autorizada", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491177770002", content: "Quiero hablar con un humano" });
    await settle();
    let conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    const before = (await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1).length;
    await simIncoming(accountId, { phone: "+5491177770002", content: "Hola? cuál es el precio?" });
    await settle();
    expect((await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1).length).toBe(before);
    // reanudar: solo con permiso (viewer no puede)
    await setAttentionMode(ctxAgentA, conv.id, { mode: "bot" });
    conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("bot");
    await simIncoming(accountId, { phone: "+5491177770002", content: "precio del taladro" });
    await settle();
    expect((await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1).length).toBe(before + 1);
  });

  it("palabra clave de derivación transfiere sin llamar a la IA", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491177770003", content: "Necesito un asesor por favor" });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("requested");
    expect(await aiSim.requests()).toHaveLength(0);
  });

  it("humano responde mientras el bot está a cargo: toma control y el bot no envía en paralelo", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491177770004", content: "Hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Te atiendo yo", idempotencyKey: `h-${Date.now()}-xx` });
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("human");
    const botSend = await sendOutbound({ tenantId: A.id, actor: { kind: "bot", botId: "x" } }, { conversationId: conv.id, text: "respuesta tardía del bot", idempotencyKey: `b-${Date.now()}-xx` });
    expect(botSend.skipped).toBe(true);
  });

  it("proveedor caído: reintentos acotados y derivación a humano sin respuestas duplicadas", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    await aiSim.mode("error500");
    const r = await simIncoming(accountId, { phone: "+5491177770005", content: "Hola, consulta" });
    // forzar los reintentos sin esperar el backoff real
    for (let i = 0; i < 4; i++) {
      await settle(1500);
      await db.execute(`update jobs set run_at = now() where status = 'queued'` as never);
    }
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect(run?.status).toBe("handed_off");
    expect(run?.lastError).toMatch(/proveedor/i);
    expect((await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1)).toHaveLength(0);
    expect((await aiSim.requests()).length).toBe(3);
    await aiSim.mode("ok");
  });

  it("cupo de IA agotado: no llama al proveedor y deriva a humano; suspensión impide respuestas automáticas", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    await db.update(subscriptions).set({ limitOverrides: { aiCallsPerMonth: 0 } }).where(eq(subscriptions.tenantId, A.id));
    const r = await simIncoming(accountId, { phone: "+5491177770006", content: "precio?" });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("requested");
    expect(await aiSim.requests()).toHaveLength(0);

    await db.update(subscriptions).set({ limitOverrides: null }).where(eq(subscriptions.tenantId, A.id));
    await changeSubscription("system", A.id, { status: "suspended" }).catch(() => undefined);
    await db.update(subscriptions).set({ status: "suspended" }).where(eq(subscriptions.tenantId, A.id));
    const r2 = await simIncoming(accountId, { phone: "+5491177770007", content: "Hola" });
    await settle();
    const conv2 = (await localConversation(A.id, r2.conversationId))!;
    expect(conv2).toBeTruthy(); // el historial sigue entrando y es legible
    expect((await simMessages(accountId, r2.conversationId)).filter((m) => m.message_type === 1)).toHaveLength(0);
    await expect(sendOutbound(ctxA, { conversationId: conv2.id, text: "hola", idempotencyKey: `s-${Date.now()}-xx` })).rejects.toThrow(/suspendida/);
  });

  it("FAQ del tenant llega al prompt (solo del propio tenant); seguimiento crea tarea", async () => {
    const { A, ctxA, ctxB } = await twoTenants();
    await addFaq(ctxA, { question: "¿Hacen envíos a domicilio?", answer: "Sí, envíos en CABA en 24 h" });
    await addFaq(ctxB, { question: "¿Hacen envíos?", answer: "SECRETO-DE-B no hacemos envíos" });
    const { accountId } = await provisionWithChannel(ctxA);
    await setupBot(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491177770008", content: "hacen envíos a domicilio? quiero seguimiento" });
    await settle();
    const req = (await aiSim.requests()).at(-1)!;
    expect(req.system).toContain("envíos en CABA");
    expect(req.system).not.toContain("SECRETO-DE-B");
    const conv = (await localConversation(A.id, r.conversationId))!;
    const t = await db.query.tasks.findFirst({ where: and(eq(tasks.tenantId, A.id), eq(tasks.contactId, conv.contactId)) });
    expect(t?.title).toBe("Llamar al cliente");
    expect(t?.createdByKind).toBe("bot");
  });
});

describe("constructor visual: borrador, validación, publicación, simulación y ejecución", () => {
  function twoRouteGraph(stageId: string): FlowGraph {
    return {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "cond", type: "condition", position: { x: 0, y: 100 }, data: { source: "message", operator: "contains_any", value: "precio, presupuesto" } },
        { id: "msgPrice", type: "message", position: { x: -200, y: 200 }, data: { text: "Hola {{contact.name}}, te paso precios en un momento." } },
        { id: "opp", type: "opportunity", position: { x: -200, y: 300 }, data: { action: "create_or_update", stageId, title: "Pidió presupuesto" } },
        { id: "wait", type: "wait", position: { x: -200, y: 400 }, data: { timeoutMinutes: 30 } },
        { id: "msgThanks", type: "message", position: { x: -200, y: 500 }, data: { text: "¡Gracias por responder!" } },
        { id: "msgOther", type: "message", position: { x: 200, y: 200 }, data: { text: "Gracias por escribir, ¿en qué te ayudo?" } },
        { id: "handoff", type: "handoff", position: { x: 200, y: 300 }, data: { reason: "Consulta general" } },
        { id: "end", type: "end", position: { x: -200, y: 600 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond", sourceHandle: "out" },
        { id: "e2", source: "cond", target: "msgPrice", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "msgOther", sourceHandle: "false" },
        { id: "e4", source: "msgPrice", target: "opp", sourceHandle: "out" },
        { id: "e5", source: "opp", target: "wait", sourceHandle: "out" },
        { id: "e6", source: "wait", target: "msgThanks", sourceHandle: "reply" },
        { id: "e7", source: "msgThanks", target: "end", sourceHandle: "out" },
        { id: "e8", source: "msgOther", target: "handoff", sourceHandle: "out" },
      ],
    };
  }

  it("flujo de 2 rutas: guarda/recarga, publica, simula sin enviar y ejecuta desde evento; borrador no altera lo publicado", async () => {
    const { A, ctxA, ctxB } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const stage = (await db.query.stages.findFirst({ where: and(eq(stages.tenantId, A.id), eq(stages.name, "Cotizado")) }))!;
    const bot = await createBot(ctxA, { name: "Flujo ventas", mode: "flow" });
    const g = twoRouteGraph(stage.id);
    const saved = await saveDraft(ctxA, bot.id, { graph: g, revision: bot.draftRevision });
    await expect(saveDraft(ctxA, bot.id, { graph: g, revision: bot.draftRevision })).rejects.toThrow(/modificado/);
    const reloaded = await getBot(ctxA, bot.id);
    expect((reloaded.bot.draftGraph as FlowGraph).nodes).toHaveLength(9);

    const sim = await simulateBot(ctxA, bot.id, { messages: ["Quiero un presupuesto", "Sí, gracias"] });
    expect(sim.events.filter((e) => e.kind === "bot").map((e) => e.text)).toEqual(["Hola Cliente de prueba, te paso precios en un momento.", "¡Gracias por responder!"]);
    expect(sim.events.some((e) => e.kind === "action" && e.text.includes("Cotizado"))).toBe(true);
    const simSends = (await (await fetch("http://localhost:3011/__sim/state")).json()).accounts.find((a: { id: number }) => a.id === accountId).conversations;
    expect(simSends).toHaveLength(0); // el simulador nunca envía WhatsApp

    const v1 = await publishBot(ctxA, bot.id);
    await setBotStatus(ctxA, bot.id, "active");
    // editar el borrador NO cambia la versión publicada
    const changed = structuredClone(g);
    (changed.nodes.find((n) => n.id === "msgOther")!.data as { text: string }).text = "TEXTO NUEVO SIN PUBLICAR";
    await saveDraft(ctxA, bot.id, { graph: changed, revision: saved.revision });

    const r1 = await simIncoming(accountId, { phone: "+5491188880001", name: "Pablo", content: "Me pasás precio?" });
    await settle();
    const conv1 = (await localConversation(A.id, r1.conversationId))!;
    let run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv1.id) });
    expect(run).toMatchObject({ status: "waiting", versionId: v1.versionId });
    await simIncoming(accountId, { phone: "+5491188880001", content: "Dale" });
    await settle();
    run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.id, run!.id) });
    expect(run!.status).toBe("completed");
    const out1 = (await simMessages(accountId, r1.conversationId)).filter((m) => m.message_type === 1).map((m) => m.content);
    expect(out1).toEqual(["Hola Pablo, te paso precios en un momento.", "¡Gracias por responder!"]);

    const r2 = await simIncoming(accountId, { phone: "+5491188880002", content: "Hola buenas" });
    await settle();
    const out2 = (await simMessages(accountId, r2.conversationId)).filter((m) => m.message_type === 1).map((m) => m.content);
    expect(out2).toEqual(["Gracias por escribir, ¿en qué te ayudo?"]);
    expect((await localConversation(A.id, r2.conversationId))!.attentionMode).toBe("requested");

    // aislamiento: B no puede leer ni publicar el bot de A
    await expect(getBot(ctxB, bot.id)).rejects.toThrow(/No encontrado/);
    await expect(publishBot(ctxB, bot.id)).rejects.toThrow(/No encontrado/);
    await expect(simulateBot(ctxB, bot.id, { messages: ["hola"] })).rejects.toThrow(/No encontrado/);
  });

  it("publicar un grafo inválido devuelve errores por nodo; operador pausa una ejecución en espera", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const bot = await createBot(ctxA, { name: "Roto", mode: "flow" });
    const bad: FlowGraph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { text: "" } },
        { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { source: "message", operator: "contains_any", value: "x" } },
      ],
      edges: [
        { id: "1", source: "start", target: "m" },
        { id: "2", source: "m", target: "c" },
        { id: "3", source: "c", target: "m", sourceHandle: "true" },
      ],
    };
    await saveDraft(ctxA, bot.id, { graph: bad, revision: bot.draftRevision });
    try {
      await publishBot(ctxA, bot.id);
      throw new Error("debió fallar");
    } catch (e) {
      const issues = (e as { details?: { issues: { nodeId?: string; message: string }[] } }).details!.issues;
      expect(issues.some((i) => i.nodeId === "m" && /vacío/.test(i.message))).toBe(true);
      expect(issues.some((i) => /Falta conectar la salida "No"/.test(i.message))).toBe(true);
      expect(issues.some((i) => /Bucle/.test(i.message))).toBe(true);
    }
    // flujo con espera + pausa manual cancela la ejecución
    const good: FlowGraph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { text: "¿Cómo te llamás?" } },
        { id: "w", type: "wait", position: { x: 0, y: 0 }, data: { timeoutMinutes: 10 } },
        { id: "m2", type: "message", position: { x: 0, y: 0 }, data: { text: "Gracias" } },
        { id: "e", type: "end", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: "1", source: "start", target: "m" },
        { id: "2", source: "m", target: "w" },
        { id: "3", source: "w", target: "m2", sourceHandle: "reply" },
        { id: "4", source: "m2", target: "e" },
      ],
    };
    const cur = await getBot(ctxA, bot.id);
    await saveDraft(ctxA, bot.id, { graph: good, revision: cur.bot.draftRevision });
    await publishBot(ctxA, bot.id);
    await setBotStatus(ctxA, bot.id, "active");
    const r = await simIncoming(accountId, { phone: "+5491188880003", content: "Hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect((await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) }))!.status).toBe("waiting");
    await setAttentionMode(ctxA, conv.id, { mode: "paused" });
    expect((await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) }))!.status).toBe("cancelled");
    await simIncoming(accountId, { phone: "+5491188880003", content: "Juan" });
    await settle();
    expect((await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1).map((m) => m.content)).toEqual(["¿Cómo te llamás?"]);
    expect((await db.select().from(conversations).where(eq(conversations.id, conv.id)))[0].attentionMode).toBe("paused");
  });

  it("límite de bots activos del plan", async () => {
    const { A, ctxA } = await twoTenants();
    await db.update(subscriptions).set({ limitOverrides: { activeBots: 1 } }).where(eq(subscriptions.tenantId, A.id));
    await setupBot(ctxA);
    const b2 = await createBot(ctxA, { name: "Segundo", mode: "instructions", aiConnectionId: (await listAiConnections(ctxA))[0].id });
    await publishBot(ctxA, b2.id);
    await expect(setBotStatus(ctxA, b2.id, "active")).rejects.toThrow(/bots activos/);
    await updateBotSettings(ctxA, b2.id, { instructions: "x" });
  });
});
