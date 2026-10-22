import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { FlowGraph } from "@/lib/flow/types";
import { routeTeamMessage, type AiRouteClassifier } from "@/lib/team/route";
import { INTENT_LABELS, ROLE_LABELS, type TeamGraph } from "@/lib/team/types";
import { db } from "../db";
import { botTeams, botVersions, bots, stages, tenants } from "../db/schema";
import { isWithinBusinessHours } from "@/lib/business-hours";
import { assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { compileInstructionsBot } from "../flows/compile";
import { draftSettings, effectiveTools, settingsFromVersion, type BotSettings } from "../flows/settings";
import { HANDOFF_LABELS } from "../flows/policy";
import { makeAiClassifier } from "../teams/orchestrator";
import { resolvePipelineIds } from "../flows/pipeline-scope";
import { BotSim, makeModelCall, newShared, type SimEvent, type SimTurnSummary } from "./simulate";
import { parseTeamGraph, teamGraphSchema, validateTeam } from "./teams";

export type TeamSimTurn = SimTurnSummary & {
  activeBot: { id: string; name: string; role: string } | null;
  previousBot: { id: string; name: string } | null;
  intent: string | null;
  signals: string[];
  transfer: { reason: string; kind: string }[];
  routeAi: boolean;
  pipeline: string | null;
  stage: string | null;
  actions: string[];
  tokens: number;
  /** eventos de este mensaje: events.slice(eventsFrom, eventsTo) */
  eventsFrom: number;
  eventsTo: number;
};

/**
 * Simulador multiagente: misma derivación, mismas reglas y mismo armado de contexto que el
 * runtime, sin enviar mensajes ni modificar el CRM (oportunidades simuladas por pipeline).
 * Bots: su versión publicada (lo que el equipo ejecutaría) o su borrador si se pide.
 */
export async function simulateTeam(ctx: Ctx, teamId: string, input: { messages: string[]; useRealAi?: boolean; graph?: unknown; botSource?: "published" | "draft"; outOfHours?: boolean }) {
  assertCan(ctx, "bot:write");
  const team = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
  if (!team) throw notFound();
  const msgs = input.messages.map((m) => String(m).slice(0, 1000)).filter((m) => m.trim()).slice(0, 12);
  if (!msgs.length) throw badRequest("Escribí al menos un mensaje de prueba.");
  const graph: TeamGraph = input.graph ? (teamGraphSchema.parse(input.graph) as TeamGraph) : parseTeamGraph(team.draftGraph);
  const issues = (await validateTeam(ctx.tenantId, graph)).filter((i) => i.severity === "error" && !(input.botSource === "draft" && /versión publicada/.test(i.message)));
  if (issues.length) return { ok: false as const, issues, events: [] as SimEvent[], turns: [] as TeamSimTurn[] };

  const botIds = [...new Set(graph.nodes.flatMap((n) => (n.type === "bot" ? [n.data.botId] : [])))];
  const rows = await db.select().from(bots).where(and(eq(bots.tenantId, ctx.tenantId), inArray(bots.id, botIds)));
  const vIds = rows.map((r) => r.publishedVersionId).filter((x): x is string => Boolean(x));
  const vers = vIds.length ? await db.select().from(botVersions).where(inArray(botVersions.id, vIds)) : [];
  const tenantStages = await db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.tenantId, ctx.tenantId));
  const tenantRow = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  const closed = input.outOfHours ?? !isWithinBusinessHours(tenantRow?.settings?.businessHours, tenantRow?.timezone ?? "America/Argentina/Buenos_Aires");
  const shared = newShared(closed, tenantRow?.settings?.outOfHoursMessage ?? null);
  let streak = 0;
  shared.onBotMessage = () => {
    streak = 0;
  };

  const sims = new Map<string, { sim: BotSim; bot: typeof bots.$inferSelect; settings: BotSettings }>();
  for (const b of rows) {
    const v = vers.find((x) => x.id === b.publishedVersionId);
    const useDraft = input.botSource === "draft" || !v;
    const settings = useDraft ? await draftSettings(b) : settingsFromVersion(b, v!.settings);
    const fg = (useDraft ? (b.mode === "instructions" ? compileInstructionsBot({ tools: settings.allowedTools, handoffKeywords: settings.handoffKeywords }) : b.draftGraph) : v!.graph) as FlowGraph;
    const call = await makeModelCall(ctx, settings, input.useRealAi, `team:${teamId}:${b.id}`);
    const sim = new BotSim(ctx, settings, fg, call, shared, Boolean(input.useRealAi), tenantStages);
    sim.botName = b.name;
    sims.set(b.id, { sim, bot: b, settings });
  }
  const teamInfo = { name: team.name, members: [...sims.values()].map((x) => ({ name: x.bot.name, role: x.settings.role, self: false })) };
  for (const x of sims.values()) x.sim.team = { ...teamInfo, members: teamInfo.members.map((m) => ({ ...m, self: m.name === x.bot.name })) };
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const botOf = (nodeId: string | null) => {
    const n = nodeId ? nodes.get(nodeId) : undefined;
    return n?.type === "bot" ? n.data.botId : null;
  };
  const nodeOf = (botId: string | null) => graph.nodes.find((n) => n.type === "bot" && n.data.botId === botId)?.id ?? null;
  const nameOf = (nodeId: string) => {
    const n = nodes.get(nodeId);
    return n?.type === "human" ? "Atención humana" : (sims.get(botOf(nodeId) ?? "")?.bot.name ?? "un bot eliminado");
  };

  let activeBot = botOf(graph.settings.entryNodeId);
  const turns: TeamSimTurn[] = [];
  for (const [i, m] of msgs.entries()) {
    const prevBot = activeBot;
    const turn: TeamSimTurn = { message: m, aiCalled: false, tools: [], blocked: [], handoff: null, activeBot: null, previousBot: null, intent: null, signals: [], transfer: [], routeAi: false, pipeline: null, stage: null, actions: [], tokens: 0, eventsFrom: shared.events.length, eventsTo: shared.events.length };
    turns.push(turn);
    shared.events.push({ kind: "user", text: m });
    shared.history.push({ direction: "in", content: m });
    if (shared.handedOff) {
      shared.events.push({ kind: "system", text: "La conversación está con una persona: ningún bot del equipo responde hasta que alguien reanude." });
      continue;
    }
    const cur = activeBot ? sims.get(activeBot) : undefined;
    if (!cur) {
      shared.events.push({ kind: "system", text: "El equipo no tiene un bot de entrada disponible." });
      continue;
    }
    // 1) insultos: suspende a todo el equipo, sin IA
    cur.sim.turn = turn;
    if (await cur.sim.insult(m)) {
      turn.activeBot = { id: cur.bot.id, name: cur.bot.name, role: cur.settings.role };
      continue;
    }
    // 2) derivación interna
    let routeTokens = 0;
    const realClassifier = input.useRealAi ? makeAiClassifier(ctx.tenantId, cur.settings, `sim-route:${teamId}:${Date.now()}:${i}`, (u) => (routeTokens += u.inputTokens + u.outputTokens)) : undefined;
    const mockClassifier: AiRouteClassifier = async () => {
      shared.events.push({ kind: "system", text: "Clasificación con IA simulada: sin proveedor real no se puede determinar el área (en producción se usaría la IA de la empresa)." });
      return { index: null };
    };
    const route = await routeTeamMessage({
      graph,
      currentNodeId: nodeOf(activeBot),
      message: m,
      streak,
      isAvailable: (nodeId) => {
        const n = nodes.get(nodeId);
        return n?.type === "bot" && !n.data.disabled && sims.has(n.data.botId);
      },
      nameOf,
      roleOf: (nodeId) => sims.get(botOf(nodeId) ?? "")?.settings.role ?? "custom",
      aiClassify: cur.settings.aiConnectionId ? (realClassifier ?? mockClassifier) : undefined,
    });
    turn.intent = route.intent;
    turn.signals = route.signals;
    turn.routeAi = route.aiUsed;
    turn.tokens += routeTokens;
    if (route.intent) shared.events.push({ kind: "system", text: `Necesidad detectada: ${INTENT_LABELS[route.intent]}${route.signals.length ? ` (señales: ${route.signals.slice(0, 3).join(", ")})` : ""}${route.aiUsed ? " — con IA" : " — sin IA"}` });
    for (const h of route.hops) {
      turn.transfer.push({ reason: h.reason, kind: h.kind });
      shared.events.push({ kind: "action", text: h.toHuman ? `Derivaría a una persona: ${h.reason}` : `Derivación interna: ${nameOf(h.from)} → ${h.to ? nameOf(h.to) : "?"} (${h.reason})` });
    }
    if (route.toHuman) {
      turn.activeBot = { id: cur.bot.id, name: cur.bot.name, role: cur.settings.role };
      cur.sim.describeHandoff("team_route", route.hops.at(-1)?.reason ?? "Derivación del equipo", true);
      continue;
    }
    const next = botOf(route.finalNodeId);
    if (next && next !== activeBot) {
      streak += route.hops.length;
      const from = sims.get(activeBot!);
      const target = sims.get(next)!;
      target.sim.reset();
      target.sim.transferNote = [`- Derivado por: ${from?.bot.name ?? "otro bot"}${from ? ` (${ROLE_LABELS[from.settings.role] ?? from.settings.role})` : ""}.`, `- Motivo: ${route.hops.at(-1)?.reason ?? ""}.`, route.intent ? `- Necesidad del cliente: ${INTENT_LABELS[route.intent]}.` : "", `- Último mensaje del cliente: "${m.slice(0, 300)}".`].filter(Boolean).join("\n");
      shared.simState.unresolvedStreak = 0;
      if (target.settings.config.pipeline.onTransferEnsureOpportunity || target.settings.config.pipeline.onTransferAssignOwner)
        shared.events.push({ kind: "action", text: `Al recibir: ${[target.settings.config.pipeline.onTransferEnsureOpportunity ? "aseguraría una oportunidad en su pipeline" : "", target.settings.config.pipeline.onTransferAssignOwner ? "asignaría su responsable por defecto" : ""].filter(Boolean).join(" y ")}` });
      const transition = route.hops.at(-1)?.message;
      if (transition) shared.events.push({ kind: "bot", text: transition });
      activeBot = next;
    }
    const s = sims.get(activeBot!)!;
    turn.activeBot = { id: s.bot.id, name: s.bot.name, role: s.settings.role };
    turn.previousBot = prevBot && prevBot !== activeBot ? { id: prevBot, name: sims.get(prevBot)?.bot.name ?? "" } : null;
    s.sim.turn = turn;
    s.sim.extra = { inputTokens: 0, outputTokens: 0, actions: [] };
    await s.sim.step(m, i, { skipInsult: true });
    turn.tokens += s.sim.extra.inputTokens + s.sim.extra.outputTokens;
    turn.actions = s.sim.extra.actions;
    if (route.aiUsed) turn.aiCalled = true;
    // pipeline y etapa (simulados) del bot que respondió
    const tools = effectiveTools(s.settings, s.settings.allowedTools);
    const scope = await resolvePipelineIds(ctx.tenantId, s.settings.config.pipeline);
    const oppKey = scope.pipelineIds.find((p) => shared.simState.opps?.[p]);
    turn.pipeline = oppKey ? (scope.names[oppKey] ?? null) : scope.primaryId ? (scope.names[scope.primaryId] ?? null) : null;
    turn.stage = oppKey ? shared.simState.opps![oppKey].stageName : null;
    if (s.settings.role === "receptionist" && tools.length !== s.settings.allowedTools.length) turn.blocked.push("La recepcionista no crea ni mueve oportunidades");
    if (turn.handoff) turn.handoff.label = HANDOFF_LABELS[turn.handoff.code as keyof typeof HANDOFF_LABELS] ?? turn.handoff.label;
  }
  turns.forEach((t, k) => (t.eventsTo = turns[k + 1]?.eventsFrom ?? shared.events.length));
  return { ok: true as const, issues: [], events: shared.events, turns, outOfHours: closed, opportunities: Object.values(shared.simState.opps ?? {}) };
}
