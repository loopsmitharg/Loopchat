import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { botTeamVersions, botTransfers, conversationActivity, conversations, flowRuns, opportunities, pipelines, stages, usageEvents } from "@/server/db/schema";
import { createAiConnection } from "@/server/services/ai-connections";
import { createBot, publishBot, setBotStatus, updateBotSettings } from "@/server/services/bots";
import { setAttentionMode, setConversationStatus } from "@/server/services/conversations";
import { updateOpportunity } from "@/server/services/opportunities";
import { createPipeline } from "@/server/services/pipelines";
import { sendOutbound } from "@/server/services/outbound";
import { createTeam, getTeam, listTeamTransfers, publishTeam, saveTeamDraft, setTeamStatus } from "@/server/services/teams";
import { simulateTeam } from "@/server/services/simulate-team";
import type { Ctx } from "@/server/authz/context";
import type { TeamGraph } from "@/lib/team/types";
import { ROLE_TEMPLATES } from "@/lib/team/roles";
import { twoTenants } from "../helpers/factory";
import { aiSim, localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});
beforeEach(async () => {
  await aiSim.reset();
});

const outgoing = async (accountId: number, cw: number) => (await simMessages(accountId, cw)).filter((m) => m.message_type === 1).map((m) => m.content);
const aiCallsFor = async (tenantId: string) => (await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.metric, "ai_calls")))).length;
let phoneSeq = 0;
const phone = () => `+54911800${String(Date.now()).slice(-4)}${String(phoneSeq++).padStart(2, "0")}`;

type SetupOpts = {
  graph?: (ids: { rec: string; ven: string; sop: string }) => Partial<Omit<TeamGraph, "settings">> & { settings?: Partial<TeamGraph["settings"]> };
  supportPipeline?: boolean;
};

/** Equipo estándar: Recepción → Ventas / Soporte; Ventas ⇄ Soporte; "hablar con una persona" → humano. */
async function setupTeam(ctx: Ctx, opts: SetupOpts = {}) {
  const conn = await createAiConnection(ctx, { provider: "openai_compatible", label: "Principal", apiKey: "sk-tenant-key-AAAA", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
  const st = await db.select().from(stages).where(eq(stages.tenantId, ctx.tenantId));
  const cotizado = st.find((s) => s.name === "Cotizado")!;
  const supportPipeline = opts.supportPipeline ? await createPipeline(ctx, { name: "Soporte" }) : null;
  const supportStages = supportPipeline ? await db.select().from(stages).where(eq(stages.pipelineId, supportPipeline.id)) : [];
  const rec = await createBot(ctx, { name: "Recepción", role: "receptionist", aiConnectionId: conn.id, instructions: `[BOT:recepcion] ${ROLE_TEMPLATES.receptionist.instructions}`, allowedTools: ["classify", "handoff", "create_opportunity"], handoffKeywords: [] });
  const ven = await createBot(ctx, {
    name: "Ventas",
    role: "sales",
    aiConnectionId: conn.id,
    instructions: "[BOT:ventas] Vendemos herramientas.",
    allowedTools: ["classify", "handoff", "create_opportunity", "update_stage", "use_catalog"],
    handoffKeywords: [],
    config: { tools: { allowedStageIds: [cotizado.id] } },
  });
  const sop = await createBot(ctx, {
    name: "Soporte",
    role: "support",
    aiConnectionId: conn.id,
    instructions: "[BOT:soporte] Ayudamos con fallas.",
    allowedTools: ["classify", "handoff", "use_knowledge"],
    handoffKeywords: [],
    config: supportPipeline ? { pipeline: { primaryPipelineId: supportPipeline.id, createOpportunity: "any_inquiry", onTransferEnsureOpportunity: true } } : undefined,
  });
  for (const b of [rec, ven, sop]) await publishBot(ctx, b.id);
  const ids = { rec: "n-rec", ven: "n-ven", sop: "n-sop" };
  const base: TeamGraph = {
    nodes: [
      { id: ids.rec, type: "bot", position: { x: 0, y: 0 }, data: { botId: rec.id } },
      { id: ids.ven, type: "bot", position: { x: 300, y: -100 }, data: { botId: ven.id } },
      { id: ids.sop, type: "bot", position: { x: 300, y: 100 }, data: { botId: sop.id } },
      { id: "human", type: "human", position: { x: 600, y: 0 }, data: {} },
    ],
    edges: [
      { id: "e1", source: ids.rec, target: ids.ven, data: { condition: { kind: "intent", intents: ["ventas"] }, enabled: true } },
      { id: "e2", source: ids.rec, target: ids.sop, data: { condition: { kind: "intent", intents: ["soporte", "atencion"] }, enabled: true } },
      { id: "e3", source: ids.ven, target: ids.sop, data: { condition: { kind: "intent", intents: ["soporte"] }, enabled: true } },
      { id: "e4", source: ids.sop, target: ids.ven, data: { condition: { kind: "intent", intents: ["ventas"] }, enabled: true } },
      { id: "e5", source: ids.rec, target: "human", data: { condition: { kind: "keywords", keywords: ["hablar con una persona"] }, enabled: true } },
    ],
    settings: { entryNodeId: ids.rec, unknownIntent: "stay", maxConsecutiveTransfers: 3, fallback: "entry" },
    automations: [],
  };
  const over = opts.graph?.({ rec: ids.rec, ven: ids.ven, sop: ids.sop }) ?? {};
  const graph: TeamGraph = { ...base, ...over, settings: { ...base.settings, ...(over.settings ?? {}) } } as TeamGraph;
  const team = await createTeam(ctx, { name: "Equipo comercial", graph: graph as never });
  await publishTeam(ctx, team.id);
  await setTeamStatus(ctx, team.id, "active");
  return { conn, rec, ven, sop, team, graph, cotizado, supportPipeline, supportStages, ids };
}

const transfersOf = (conversationId: string) => db.select().from(botTransfers).where(eq(botTransfers.conversationId, conversationId)).orderBy(botTransfers.createdAt);

describe("equipos de chatbots: derivación interna", () => {
  it("un bot individual sigue funcionando igual (sin equipo, sin fijación)", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const conn = await createAiConnection(ctxA, { provider: "openai_compatible", label: "Principal", apiKey: "sk-tenant-key-AAAA", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
    const bot = await createBot(ctxA, { name: "Solo", aiConnectionId: conn.id, instructions: "[BOT:solo] Hola" });
    await publishBot(ctxA, bot.id);
    await setBotStatus(ctxA, bot.id, "active");
    const r = await simIncoming(accountId, { phone: phone(), content: "cuánto sale el taladro?" });
    await settle();
    expect(await outgoing(accountId, r.conversationId)).toEqual(["[solo] El taladro percutor cuesta $85.000. ¿Querés que te lo reserve?"]);
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.teamId).toBeNull();
    expect(conv.activeBotId).toBeNull();
    expect(await transfersOf(conv.id)).toHaveLength(0);
  });

  it("recepcionista → ventas sin IA de clasificación; ventas responde con contexto, crea la oportunidad en su pipeline y mueve a etapa autorizada", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const r = await simIncoming(accountId, { phone: phone(), name: "Carla", content: "Hola, cuánto sale el taladro percutor?" });
    await settle();
    // una sola llamada a la IA (la de ventas): la recepcionista derivó con reglas, sin IA
    const reqs = await aiSim.requests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toContain("[BOT:ventas]");
    expect(reqs[0].system).toContain("TRASPASO INTERNO");
    expect(reqs[0].system).toContain("Derivado por: Recepción (Recepcionista)");
    expect(await outgoing(accountId, r.conversationId)).toEqual(["[ventas+ctx] El taladro percutor cuesta $85.000. ¿Querés que te lo reserve?"]);
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.teamId).toBe(t.team.id);
    expect(conv.activeBotId).toBe(t.ven.id);
    const tr = await transfersOf(conv.id);
    expect(tr.map((x) => [x.kind, x.fromBotId, x.toBotId])).toEqual([
      ["entry", null, t.rec.id],
      ["intent", t.rec.id, t.ven.id],
    ]);
    expect(tr[1].intent).toBe("ventas");
    const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)) });
    expect(opp?.stageId).toBe(t.cotizado.id);
    expect(opp?.source).toBe("bot");
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect(run?.botId).toBe(t.ven.id);
    expect(run?.metrics).toMatchObject({ routed: true, team: { intent: "ventas" } });
  });

  it("un reclamo que menciona un precio NO es venta: recepcionista → soporte, sin oportunidad comercial", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const r = await simIncoming(accountId, { phone: phone(), content: "Compré una amoladora y dejó de funcionar, cuánto sale arreglarla?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.activeBotId).toBe(t.sop.id);
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ kind: "intent", intent: "soporte", toBotId: t.sop.id });
    expect((await outgoing(accountId, r.conversationId))[0]).toMatch(/^\[soporte\+ctx\]/);
    // soporte no tiene la herramienta de oportunidades: aunque la IA lo intente, no se crea
    expect(await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)) })).toBeUndefined();
  });

  it("ventas → soporte y soporte → ventas conservan historial, contexto y un solo bot activo", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "precio del taladro?" });
    await settle();
    await simIncoming(accountId, { phone: p, content: "ah y la sierra que compré no funciona" });
    await settle();
    let conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.activeBotId).toBe(t.sop.id);
    let reqs = await aiSim.requests();
    expect(reqs.at(-1)!.system).toContain("Derivado por: Ventas (Ventas)");
    await simIncoming(accountId, { phone: p, content: "ok gracias, quiero comprar otra sierra, qué precio tiene?" });
    await settle();
    conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.activeBotId).toBe(t.ven.id);
    reqs = await aiSim.requests();
    expect(reqs).toHaveLength(3);
    const out = await outgoing(accountId, r.conversationId);
    expect(out.map((o) => o.split("]")[0])).toEqual(["[ventas+ctx", "[soporte+ctx", "[ventas+ctx"]);
    expect((await transfersOf(conv.id)).map((x) => x.kind)).toEqual(["entry", "intent", "intent", "intent"]);
    expect(conv.botState).toMatchObject({ transfer: { fromBotId: t.sop.id, toBotId: t.ven.id } });
  });

  it("pipeline correcto por bot: soporte asegura la oportunidad en su pipeline al recibir; ventas en el principal", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA, { supportPipeline: true });
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "el taladro no enciende" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const opps = await db.select().from(opportunities).where(and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)));
    expect(opps).toHaveLength(1);
    expect(opps[0].pipelineId).toBe(t.supportPipeline!.id);
    expect(opps[0].stageId).toBe(t.supportStages.find((s) => s.position === 0)!.id);
    // luego una consulta de compra: ventas crea OTRA oportunidad en el pipeline principal (una por pipeline)
    await simIncoming(accountId, { phone: p, content: "y cuánto cuesta una amoladora nueva?" });
    await settle();
    const all = await db.select().from(opportunities).where(and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)));
    expect(all).toHaveLength(2);
    const main = (await db.query.pipelines.findFirst({ where: and(eq(pipelines.tenantId, A.id), eq(pipelines.isDefault, true)) }))!;
    expect(all.find((o) => o.pipelineId === main.id)?.stageId).toBe(t.cotizado.id);
  });

  it("mover etapas: solo las autorizadas; recepcionista nunca crea oportunidades", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const st = await db.select().from(stages).where(eq(stages.tenantId, A.id));
    const t = await setupTeam(ctxA);
    // ventas solo puede mover a "Seguimiento": "Cotizado" queda bloqueado
    const seguimiento = st.find((s) => s.name === "Seguimiento")!;
    await updateBotSettings(ctxA, t.ven.id, { config: { tools: { allowedStageIds: [seguimiento.id] } } });
    await publishBot(ctxA, t.ven.id);
    await publishTeam(ctxA, t.team.id);
    const r = await simIncoming(accountId, { phone: phone(), content: "precio de la amoladora?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)) });
    expect(opp).toBeDefined();
    expect(opp!.stageId).not.toBe(t.cotizado.id);
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect(JSON.stringify(run?.metrics)).toContain("update_stage");

    // la recepcionista: el rol le quita create_opportunity aunque se pida
    const recRow = await db.query.bots.findFirst({ where: (b, { eq: e }) => e(b.id, t.rec.id) });
    expect(recRow!.allowedTools).not.toContain("create_opportunity");
  });

  it("derivación a una persona: todo el equipo se detiene; reanudar manualmente con un bot elegido", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "quiero hablar con una persona por favor" });
    await settle();
    let conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    expect(await aiSim.requests()).toHaveLength(0);
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ toHuman: true, kind: "keyword" });
    await simIncoming(accountId, { phone: p, content: "precio del taladro?" });
    await settle();
    expect(await aiSim.requests()).toHaveLength(0);
    // no hay retoma automática: una persona reanuda y elige el bot
    await setAttentionMode(ctxAgentA, conv.id, { mode: "bot", botId: t.ven.id });
    conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("bot");
    expect(conv.activeBotId).toBe(t.ven.id);
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ kind: "manual", toBotId: t.ven.id });
    await simIncoming(accountId, { phone: p, content: "entonces el precio?" });
    await settle();
    expect((await outgoing(accountId, r.conversationId)).at(-1)).toMatch(/^\[ventas\]/);
    await expect(setAttentionMode(ctxAgentA, conv.id, { mode: "paused", botId: t.ven.id })).rejects.toThrow();
  });

  it("insultos: derivación sin IA que suspende a todo el equipo", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "sos un pelotudo, cuánto sale el taladro" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    expect(await aiCallsFor(A.id)).toBe(0);
    // no se derivó a ventas antes de evaluar el insulto
    expect((await transfersOf(conv.id)).map((x) => x.kind)).toEqual(["entry"]);
    await simIncoming(accountId, { phone: p, content: "precio?" });
    await settle();
    expect(await aiCallsFor(A.id)).toBe(0);
  });

  it("bot deshabilitado → vuelve al bot de entrada; sin destino y 'pasar a persona' → humano", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA, { graph: (ids) => ({ settings: { entryNodeId: ids.rec, unknownIntent: "human", maxConsecutiveTransfers: 3, fallback: "entry" } }) });
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "precio del taladro" });
    await settle();
    // se deshabilita Soporte en una nueva versión: las conversaciones nuevas usan la nueva versión
    const g = (await getTeam(ctxA, t.team.id)).team.draftGraph;
    g.nodes = g.nodes.map((n) => (n.id === t.ids.sop && n.type === "bot" ? { ...n, data: { ...n.data, disabled: true } } : n));
    await saveTeamDraft(ctxA, t.team.id, { graph: g, revision: (await getTeam(ctxA, t.team.id)).team.draftRevision });
    await publishTeam(ctxA, t.team.id);
    // conversación nueva: soporte deshabilitado → recepción no puede derivar → (entrada = actual) → persona
    const p2 = phone();
    const r2 = await simIncoming(accountId, { phone: p2, content: "mi taladro no funciona" });
    await settle();
    const conv2 = (await localConversation(A.id, r2.conversationId))!;
    expect(conv2.attentionMode).toBe("requested");
    expect((await transfersOf(conv2.id)).at(-1)).toMatchObject({ toHuman: true, kind: "unavailable" });
    // la conversación vieja sigue con su versión (soporte habilitado): ventas → soporte
    await simIncoming(accountId, { phone: p, content: "otra cosa: la sierra no funciona" });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.activeBotId).toBe(t.sop.id);
    // sin necesidad identificada y regla "pasar a una persona"
    const r3 = await simIncoming(accountId, { phone: phone(), content: "necesito algo especial para mi casa de campo" });
    await settle();
    const conv3 = (await localConversation(A.id, r3.conversationId))!;
    expect(conv3.attentionMode).toBe("requested");
    expect((await transfersOf(conv3.id)).at(-1)).toMatchObject({ kind: "unknown" });
  });

  it("bot activo no disponible en una conversación en curso → vuelve al bot de entrada (respaldo)", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "precio del taladro" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.activeBotId).toBe(t.ven.id);
    // simulamos que el bot activo ya no pertenece a la versión fijada (p. ej. se quitó)
    const v = (await getTeam(ctxA, t.team.id)).published!;
    const pins = { ...v.botVersions };
    delete pins[t.ven.id];
    await db.update(botTeamVersions).set({ botVersions: pins }).where(eq(botTeamVersions.id, v.id));
    await simIncoming(accountId, { phone: p, content: "hola de nuevo" });
    await settle();
    const after = (await localConversation(A.id, r.conversationId))!;
    expect(after.activeBotId).toBe(t.rec.id);
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ kind: "unavailable", toBotId: t.rec.id });
    expect((await outgoing(accountId, r.conversationId)).at(-1)).toMatch(/^\[recepcion\+ctx\]/);
  });

  it("límite de derivaciones seguidas: cadena que lo supera pasa a una persona (protección contra bucles)", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setupTeam(ctxA, {
      graph: (ids) => ({
        edges: [
          { id: "k1", source: ids.rec, target: ids.ven, data: { condition: { kind: "keywords", keywords: ["garantía extendida"] }, enabled: true } },
          { id: "k2", source: ids.ven, target: ids.sop, data: { condition: { kind: "keywords", keywords: ["garantía extendida"] }, enabled: true } },
        ],
        settings: { maxConsecutiveTransfers: 1 },
      }),
    });
    const r = await simIncoming(accountId, { phone: phone(), content: "quiero la garantía extendida" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ toHuman: true, kind: "loop_guard" });
    expect(await aiSim.requests()).toHaveLength(0);
  });

  it("webhook duplicado y dos mensajes simultáneos: una sola derivación, sin respuestas duplicadas", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "precio del taladro?", duplicateDelivery: true });
    await simIncoming(accountId, { phone: p, content: "precio de la amoladora?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const tr = await transfersOf(conv.id);
    expect(tr.filter((x) => x.kind === "entry")).toHaveLength(1);
    expect(tr.filter((x) => x.toBotId === t.ven.id)).toHaveLength(1);
    const out = await outgoing(accountId, r.conversationId);
    // a lo sumo una respuesta por mensaje distinto (el duplicado no genera otra)
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.every((o) => o.startsWith("[ventas"))).toBe(true);
    const opps = await db.select().from(opportunities).where(and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)));
    expect(opps).toHaveLength(1);
  });

  it("respuesta tardía: un bot que ya no está activo no puede enviar; una persona que interviene descarta la respuesta en curso", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "precio del taladro?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    // la recepcionista (ya no activa) intenta responder tarde
    const late = await sendOutbound({ tenantId: A.id, actor: { kind: "bot", botId: t.rec.id } }, { conversationId: conv.id, text: "respuesta tardía", idempotencyKey: `late:${conv.id}:1` });
    expect(late.skipped).toBe(true);
    // la IA tarda; mientras, una persona toma la conversación
    await aiSim.mode("slow");
    await simIncoming(accountId, { phone: p, content: "y el precio de la amoladora?" });
    const pending = settle(12000);
    await new Promise((res) => setTimeout(res, 1500));
    await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Hola, te atiendo yo", idempotencyKey: `human:${conv.id}:1` });
    await pending;
    await aiSim.mode("ok");
    const out = await outgoing(accountId, r.conversationId);
    expect(out).not.toContain("respuesta tardía");
    expect(out.at(-1)).toBe("Hola, te atiendo yo");
    expect(out.filter((o) => o.startsWith("[ventas"))).toHaveLength(1);
  }, 30000);

  it("aislamiento entre empresas: no se ven equipos ajenos ni se pueden usar bots de otra empresa", async () => {
    const { ctxA, ctxB } = await twoTenants();
    const t = await setupTeam(ctxA);
    await expect(getTeam(ctxB, t.team.id)).rejects.toThrow();
    const tb = await createTeam(ctxB, { name: "Equipo B" });
    const g = (await getTeam(ctxB, tb.id)).team.draftGraph;
    g.nodes.push({ id: "x", type: "bot", position: { x: 0, y: 0 }, data: { botId: t.ven.id } });
    await expect(saveTeamDraft(ctxB, tb.id, { graph: g, revision: 0 })).rejects.toThrow(/no existe/);
    expect(await listTeamTransfers(ctxB, tb.id)).toEqual([]);
  });

  it("simulación multiagente: muestra bot activo, derivación e intención, sin cambios reales", async () => {
    const { A, ctxA } = await twoTenants();
    const t = await setupTeam(ctxA);
    const before = await db.select().from(opportunities).where(eq(opportunities.tenantId, A.id));
    const res = await simulateTeam(ctxA, t.team.id, { messages: ["hola", "quiero comprar un taladro", "compré una sierra y no funciona", "quiero hablar con una persona"] });
    expect(res.ok).toBe(true);
    expect(res.turns.map((x) => x.activeBot?.name)).toEqual(["Recepción", "Ventas", "Soporte", "Soporte"]);
    expect(res.turns[1]).toMatchObject({ intent: "ventas", previousBot: { name: "Recepción" } });
    expect(res.turns[1].transfer[0].reason).toContain("Ventas");
    expect(res.turns[2].intent).toBe("soporte");
    expect(res.turns[1].actions.join(" ")).toContain("Crearía");
    expect(res.turns[1].stage).toBe("Nuevo");
    expect(res.turns[1].pipeline).toBeTruthy();
    expect(res.turns[3].handoff?.code).toBe("ai");
    expect(await db.select().from(opportunities).where(eq(opportunities.tenantId, A.id))).toHaveLength(before.length);
    expect(await db.select().from(botTransfers).where(eq(botTransfers.tenantId, A.id))).toHaveLength(0);
  });

  it("versiones: publicar no cambia conversaciones en curso; resolver libera la fijación", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const t = await setupTeam(ctxA);
    const p = phone();
    const r = await simIncoming(accountId, { phone: p, content: "hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const v1 = conv.teamVersionId;
    // v2 sin la derivación a ventas
    const g = (await getTeam(ctxA, t.team.id)).team.draftGraph;
    g.edges = g.edges.filter((e) => e.id !== "e1");
    await saveTeamDraft(ctxA, t.team.id, { graph: g, revision: (await getTeam(ctxA, t.team.id)).team.draftRevision });
    const pub = await publishTeam(ctxA, t.team.id);
    expect(pub.version).toBe(2);
    await simIncoming(accountId, { phone: p, content: "precio del taladro?" });
    await settle();
    let now = (await localConversation(A.id, r.conversationId))!;
    expect(now.teamVersionId).toBe(v1);
    expect(now.activeBotId).toBe(t.ven.id);
    await setConversationStatus(ctxAgentA, conv.id, "resolved");
    now = (await localConversation(A.id, r.conversationId))!;
    expect(now.teamVersionId).toBeNull();
    const d = await getTeam(ctxA, t.team.id);
    expect(d.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(d.unpublishedChanges).toBe(false);
  });

  it("validación antes de publicar: bucle por la misma necesidad, recepcionista con herramientas de venta, sin entrada", async () => {
    const { ctxA } = await twoTenants();
    const t = await setupTeam(ctxA);
    const g = (await getTeam(ctxA, t.team.id)).team.draftGraph;
    g.edges.push({ id: "loop", source: t.ids.sop, target: t.ids.rec, data: { condition: { kind: "intent", intents: ["soporte"] }, enabled: true } });
    g.settings.entryNodeId = null;
    const saved = await saveTeamDraft(ctxA, t.team.id, { graph: g, revision: (await getTeam(ctxA, t.team.id)).team.draftRevision });
    const msgs = saved.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/Bucle de derivaciones para "soporte"/);
    expect(msgs).toMatch(/bot de entrada/);
    await expect(publishTeam(ctxA, t.team.id)).rejects.toThrow(/errores/);
  });

  it("cupo de bots activos: los bots de equipos activos cuentan una sola vez", async () => {
    const { ctxA } = await twoTenants();
    const t = await setupTeam(ctxA); // growth: 5 bots activos; el equipo usa 3
    await setBotStatus(ctxA, t.ven.id, "active"); // ya contado por el equipo
    const conn = t.conn;
    const extra = [];
    for (let i = 0; i < 2; i++) {
      const b = await createBot(ctxA, { name: `Extra ${i}`, aiConnectionId: conn.id });
      await publishBot(ctxA, b.id);
      await setBotStatus(ctxA, b.id, "active");
      extra.push(b);
    }
    const b6 = await createBot(ctxA, { name: "Sexto", aiConnectionId: conn.id });
    await publishBot(ctxA, b6.id);
    await expect(setBotStatus(ctxA, b6.id, "active")).rejects.toThrow(/máximo de bots activos/);
    await setTeamStatus(ctxA, t.team.id, "inactive");
    await setBotStatus(ctxA, b6.id, "active");
    await expect(setTeamStatus(ctxA, t.team.id, "active")).rejects.toThrow(/máximo de bots activos/);
  });
});

describe("automatizaciones del pipeline", () => {
  it("etapa alcanzada → activa un bot; oportunidad cerrada → detiene el bot (sin retomar conversaciones humanas)", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const st = await db.select().from(stages).where(eq(stages.tenantId, A.id));
    const seguimiento = st.find((s) => s.name === "Seguimiento")!;
    const t = await setupTeam(ctxA);
    const g = (await getTeam(ctxA, t.team.id)).team.draftGraph;
    g.automations = [
      { id: "a1", enabled: true, trigger: { kind: "stage_entered", stageId: seguimiento.id }, action: { kind: "activate_bot", botId: t.sop.id } },
      { id: "a2", enabled: true, trigger: { kind: "opportunity_closed", pipelineId: null }, action: { kind: "stop_bot", botId: null } },
    ];
    await saveTeamDraft(ctxA, t.team.id, { graph: g, revision: (await getTeam(ctxA, t.team.id)).team.draftRevision });
    await publishTeam(ctxA, t.team.id);
    const r = await simIncoming(accountId, { phone: phone(), content: "precio del taladro?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    // la conversación quedó fijada a la versión 1 (sin automatizaciones): se fija de nuevo al resolver/abrir
    await db.update(conversations).set({ teamVersionId: (await getTeam(ctxA, t.team.id)).published!.id }).where(eq(conversations.id, conv.id));
    let opp = (await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)) }))!;
    await updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, stageId: seguimiento.id });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.activeBotId).toBe(t.sop.id);
    expect((await transfersOf(conv.id)).at(-1)).toMatchObject({ kind: "automation", toBotId: t.sop.id });
    opp = (await db.query.opportunities.findFirst({ where: eq(opportunities.id, opp.id) }))!;
    const ganado = st.find((s) => s.name === "Ganado")!;
    await updateOpportunity(ctxA, opp.id, { expectedVersion: opp.version, stageId: ganado.id });
    await settle();
    const after = (await localConversation(A.id, r.conversationId))!;
    expect(after.attentionMode).toBe("paused");
    const act = await db.query.conversationActivity.findFirst({ where: and(eq(conversationActivity.conversationId, conv.id), eq(conversationActivity.kind, "bot_paused")) });
    expect(act?.actorKind).toBe("system");
  });
});
