import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FlowGraph, FlowNode } from "@/lib/flow/types";
import { db } from "../db";
import { botProducts, botTeams, botVersions, bots, contacts, conversations, flowRunSteps, flowRuns, tenants, type ConversationBotState } from "../db/schema";
import { isWithinBusinessHours } from "@/lib/business-hours";
import type { Ctx } from "../authz/context";
import { AiProviderError } from "../ai/types";
import { getTenantChatwoot } from "../chatwoot/tenant-client";
import { enqueue } from "../jobs/queue";
import { log } from "../log";
import { loadProviderForTenant } from "../services/ai-connections";
import { retryOutbound, sendOutbound } from "../services/outbound";
import { completeAiCall, getPlanState, isOperational, reserveAiCall } from "../services/usage";
import { applyOpportunity, runAiTurn, type TurnLog } from "./ai-turn";
import { runFlow, type AiNodeResult, type FlowContext, type FlowEffects, type RunOutcome } from "./interpreter";
import { checkInsult, handoffWithPolicy, OUT_OF_HOURS_NOTE, type HandoffCode } from "./policy";
import { settingsFromVersion, type BotSettings } from "./settings";
import { applyTransferActions, loadTeamVersion, routeIncoming } from "../teams/orchestrator";

export class FlowStepError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

type RunRow = typeof flowRuns.$inferSelect;

/** Métricas de diagnóstico de una ejecución (sin secretos ni contenido sensible). */
export type RunMetrics = {
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  tools: string[];
  blocked: string[];
  products: string[];
  handoffCode?: string;
  handoffReason?: string;
  insultTerms?: string[];
  guard?: string;
  /** Versión y huella de las instrucciones efectivas usadas (auditoría). */
  instructions?: { version: string; hash: string };
  /** Equipos: el mensaje ya fue derivado (los reintentos no vuelven a derivar). */
  routed?: boolean;
  team?: { intent: string | null; signals: string[]; hops: { from: string | null; to: string | null; toHuman: boolean; kind: string; reason: string }[]; fromBotId: string | null; aiUsed: boolean; actions?: string[] };
};

function newMetrics(): RunMetrics {
  return { aiCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, tools: [], blocked: [], products: [] };
}
function mergeTurn(m: RunMetrics, t: TurnLog) {
  if (t.aiCalled) m.aiCalls++;
  m.inputTokens += t.inputTokens;
  m.outputTokens += t.outputTokens;
  m.latencyMs += t.latencyMs;
  m.tools = [...new Set([...m.tools, ...t.tools])];
  m.blocked = [...m.blocked, ...t.blocked].slice(0, 20);
  m.products = [...new Set([...m.products, ...t.products.map((p) => p.title)])].slice(0, 10);
  if (t.instructions) m.instructions = t.instructions;
}

export function makeRuntimeEffects(run: RunRow, bot: typeof bots.$inferSelect, settings: BotSettings, attempt: number, metrics: RunMetrics): FlowEffects {
  const ctx: Ctx = { tenantId: run.tenantId, actor: { kind: "bot", botId: bot.id, runId: run.id } };
  return {
    now: () => new Date(),
    async stillInControl() {
      const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, run.conversationId), eq(conversations.tenantId, run.tenantId)) });
      if (!conv || conv.attentionMode !== "bot") return false;
      // equipos: solo el bot activo sigue en control
      if (conv.teamId && conv.activeBotId && conv.activeBotId !== bot.id) return false;
      const plan = await getPlanState(run.tenantId);
      return isOperational(plan);
    },
    async sendMessage(text, key) {
      const res = await sendOutbound(ctx, { conversationId: run.conversationId, text, idempotencyKey: `bot:${key}`, origin: { botId: bot.id, versionId: run.versionId, runId: run.id } }).catch((e) => {
        throw new FlowStepError((e as Error).message, (e as { status?: number }).status === 502);
      });
      if (res.duplicate && res.status === "failed") await retryOutbound(ctx, res.messageId);
      // un bot respondió: se reinicia la racha de derivaciones seguidas (protección contra bucles)
      if (!res.skipped) await db.update(conversations).set({ botState: sql`${conversations.botState} - 'transferStreak'` }).where(and(eq(conversations.id, run.conversationId), sql`${conversations.botState} ? 'transferStreak'`));
    },
    async sendAttachment(a, key) {
      // la foto es complementaria: si falla no se reintenta toda la ejecución
      try {
        const res = await sendOutbound(ctx, { conversationId: run.conversationId, text: a.title, idempotencyKey: `bot:${key}`, attachment: { productId: a.productId }, origin: { botId: bot.id, versionId: run.versionId, runId: run.id } });
        if (!res.skipped) metrics.tools = [...new Set([...metrics.tools, "send_photo"])];
      } catch (e) {
        log.warn("flow.photo_failed", { runId: run.id, err: (e as Error).message });
      }
    },
    async ai(node, fctx, key) {
      return runAiNode(ctx, run, settings, node, fctx, `${key}:a${attempt}`, metrics);
    },
    async opportunity(data, fctx) {
      await applyOpportunity(ctx, run.tenantId, run.conversationId, { stageId: data.stageId ?? null, title: data.title, amount: data.amount ?? null }, fctx.contactName ?? null);
    },
    async handoff(reason, meta) {
      const code = (meta.code || "flow") as HandoffCode;
      metrics.handoffCode = code;
      metrics.handoffReason = reason.slice(0, 200);
      // la IA ya avisó al cliente: no se duplica el mensaje de transferencia
      await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason, code, config: settings.config, sendTransfer: !(code === "ai" && meta.aiReplied) });
    },
    async checkpoint(state, step) {
      await db
        .update(flowRuns)
        .set({ currentNodeId: state.currentNodeId, context: state.context as unknown as Record<string, unknown>, stepCount: state.stepCount, updatedAt: new Date() })
        .where(eq(flowRuns.id, run.id));
      await db.insert(flowRunSteps).values({ tenantId: run.tenantId, runId: run.id, nodeId: step.nodeId, nodeType: step.nodeType, status: "completed", summary: step.summary.slice(0, 200) });
    },
  };
}

async function conversationHistory(tenantId: string, conversationId: string) {
  try {
    const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    if (!conv) return [];
    const { client } = await getTenantChatwoot(tenantId);
    const res = await client.listMessages(conv.chatwootConversationId);
    return res.payload
      .filter((m) => !m.private && (m.message_type === 0 || m.message_type === 1 || m.message_type === 3))
      .sort((a, b) => a.created_at - b.created_at)
      .map((m) => ({ direction: (m.message_type === 0 ? "in" : "out") as "in" | "out", content: m.content ?? "" }));
  } catch (e) {
    log.warn("flow.history_unavailable", { tenantId, err: e });
    return [];
  }
}

async function runAiNode(ctx: Ctx, run: RunRow, settings: BotSettings, node: FlowNode<"ai">, fctx: FlowContext, key: string, metrics: RunMetrics): Promise<AiNodeResult> {
  if (!settings.aiConnectionId) return { handoff: { reason: "El bot no tiene proveedor de IA configurado", code: "no_ai" } };
  const loaded = await loadProviderForTenant(run.tenantId, settings.aiConnectionId);
  if (!loaded) return { handoff: { reason: "La conexión de IA fue revocada", code: "no_ai" } };
  const model = settings.model || loaded.row.defaultModel;
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, run.conversationId), eq(conversations.tenantId, run.tenantId)) });
  const history = await conversationHistory(run.tenantId, run.conversationId);
  const { result, log: turn } = await runAiTurn({
    tenantId: run.tenantId,
    settings,
    node,
    message: fctx.lastMessage,
    history,
    contactName: fctx.contactName ?? null,
    conversationId: run.conversationId,
    contactId: conv?.contactId ?? null,
    dryRun: false,
    ctx,
    outOfHoursNote: fctx.vars.fuera_de_horario === "si" ? OUT_OF_HOURS_NOTE : null,
    transferNote: transferNoteFor(conv, run.botId),
    botName: (await db.query.bots.findFirst({ columns: { name: true }, where: eq(bots.id, run.botId) }))?.name ?? "",
    team: conv?.teamVersionId ? await teamContext(run.tenantId, conv.teamVersionId, run.botId) : null,
    async callModel(req) {
      const reservation = await reserveAiCall(run.tenantId, key, { provider: loaded.row.provider, model });
      if (!reservation.ok) return { handoff: { reason: reservation.reason === "quota_exceeded" ? "Cupo mensual de IA agotado" : "Suscripción inactiva", code: "quota" } };
      try {
        const r = await loaded.provider.chat({ model, system: req.system, messages: req.messages, jsonMode: true, maxTokens: req.maxTokens, ...(req.temperature !== null && req.temperature !== undefined ? { temperature: req.temperature } : {}) });
        await completeAiCall(reservation.eventId, "success", { inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        return r;
      } catch (e) {
        await completeAiCall(reservation.eventId, "failure", { detail: (e as Error).message });
        if (e instanceof AiProviderError) throw new FlowStepError(e.message, e.retryable);
        throw e;
      }
    },
  });
  mergeTurn(metrics, turn);
  return result;
}

/** Equipo de la conversación: nombres y roles para la coordinación entre bots. */
async function teamContext(tenantId: string, teamVersionId: string, botId: string) {
  const tv = await loadTeamVersion(tenantId, teamVersionId);
  if (!tv) return null;
  const team = await db.query.botTeams.findFirst({ columns: { name: true }, where: eq(botTeams.id, tv.teamId) });
  const members = [...tv.bots.values()].map((b) => ({ name: b.bot.name, role: b.settings.role, self: b.bot.id === botId }));
  return { name: team?.name ?? "Equipo", members };
}

/** Resumen del traspaso para el bot que recibió la conversación (mientras siga activo). */
function transferNoteFor(conv: typeof conversations.$inferSelect | undefined, botId: string) {
  const t = ((conv?.botState ?? {}) as ConversationBotState).transfer;
  return conv?.teamId && t && t.toBotId === botId ? t.note : null;
}

/** Datos sensibles fuera del contexto persistido al terminar (minimización). */
function scrub(context: FlowContext): Record<string, unknown> {
  const hidden = new Set(["handoff_reason", "horario", "handoff_code", "ai_replied", "fuera_de_horario"]);
  return { intent: context.intent ?? null, vars: Object.fromEntries(Object.entries(context.vars).filter(([k]) => !hidden.has(k))) };
}

export type RunJob = { runId: string; mode: "start" | "reply" | "timeout"; message?: string; expectStep?: number };

const sameDay = (iso: string | undefined, now: Date) => Boolean(iso) && iso!.slice(0, 10) === now.toISOString().slice(0, 10);

/**
 * Reglas previas a la IA (no consumen la API del cliente):
 * 1. insultos/agresiones → derivación inmediata (motivo insult_detection);
 * 2. fuera de horario → aviso fijo y, según la regla, derivación;
 * 3. primer contacto → mensaje fijo de bienvenida.
 * Devuelve el resultado si la ejecución termina acá.
 */
async function insultGuard(run: RunRow, bot: typeof bots.$inferSelect, settings: BotSettings, message: string, metrics: RunMetrics): Promise<boolean> {
  const cfg = settings.config;
  const insult = await checkInsult(run.tenantId, cfg, message);
  if (!insult.flagged) return false;
  metrics.guard = "insult_detection";
  metrics.handoffCode = "insult_detection";
  metrics.handoffReason = "Insulto o agresión verbal detectada";
  metrics.insultTerms = insult.matches.map((m) => `${m.term} (${m.lang})`).slice(0, 5);
  await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: "Se detectó lenguaje ofensivo en el mensaje del cliente", code: "insult_detection", config: cfg, sendTransfer: true, data: { languages: [...new Set(insult.matches.map((m) => m.lang))] } });
  await db.insert(flowRunSteps).values({ tenantId: run.tenantId, runId: run.id, nodeId: "guard", nodeType: "guard", status: "completed", summary: "insulto detectado → derivado a humano (sin IA)" });
  return true;
}

async function preAiGuards(run: RunRow, bot: typeof bots.$inferSelect, settings: BotSettings, mode: "start" | "reply", message: string, horario: "abierto" | "cerrado", metrics: RunMetrics, skipInsult = false): Promise<{ done: true; outcome: "handed_off" } | { done: false; outOfHoursNote: string | null }> {
  const ctx: Ctx = { tenantId: run.tenantId, actor: { kind: "bot", botId: bot.id, runId: run.id } };
  const cfg = settings.config;
  if (!skipInsult && (await insultGuard(run, bot, settings, message, metrics))) return { done: true, outcome: "handed_off" };
  // límite de uso de IA por conversación (determinístico, antes de llamar a la IA)
  const maxCalls = cfg.operation.maxAiCallsPerConversation;
  if (maxCalls > 0) {
    const [{ n }] = await db.select({ n: sql<number>`coalesce(sum((${flowRuns.metrics}->>'aiCalls')::int), 0)::int` }).from(flowRuns).where(and(eq(flowRuns.tenantId, run.tenantId), eq(flowRuns.conversationId, run.conversationId)));
    if (n >= maxCalls) {
      metrics.guard = "usage_limit";
      metrics.handoffCode = "usage_limit";
      metrics.handoffReason = `Se alcanzó el límite de ${maxCalls} llamadas a la IA en la conversación`;
      await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: metrics.handoffReason, code: "usage_limit", config: cfg, sendTransfer: true });
      return { done: true, outcome: "handed_off" };
    }
  }
  if (mode !== "start") return { done: false, outOfHoursNote: null };

  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, run.conversationId), eq(conversations.tenantId, run.tenantId)) });
  if (!conv) return { done: false, outOfHoursNote: null };
  const state = { ...((conv.botState ?? {}) as ConversationBotState) };
  const now = new Date();
  let note: string | null = null;
  const send = (text: string, key: string) => sendOutbound(ctx, { conversationId: run.conversationId, text, idempotencyKey: key, origin: { botId: bot.id, versionId: run.versionId, runId: run.id } });

  if (horario === "cerrado" && cfg.hours.outOfHours !== "respond") {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, run.tenantId) });
    const text = (cfg.hours.outOfHoursMessage || tenant?.settings?.outOfHoursMessage || "Estamos fuera de nuestro horario de atención. Te respondemos apenas volvamos.").trim();
    if (!sameDay(state.outOfHoursNotifiedAt, now)) {
      await send(text, `ooh:${conv.id}:${now.toISOString().slice(0, 10)}`).catch((e) => log.warn("flow.ooh_message_failed", { runId: run.id, err: (e as Error).message }));
      state.outOfHoursNotifiedAt = now.toISOString();
      await db.update(conversations).set({ botState: state }).where(eq(conversations.id, conv.id));
    }
    if (cfg.hours.outOfHours === "message_and_handoff") {
      metrics.guard = "out_of_hours";
      metrics.handoffCode = "out_of_hours";
      metrics.handoffReason = "Mensaje fuera de horario";
      await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: "Mensaje fuera del horario de atención", code: "out_of_hours", config: cfg, sendTransfer: false });
      await db.insert(flowRunSteps).values({ tenantId: run.tenantId, runId: run.id, nodeId: "guard", nodeType: "guard", status: "completed", summary: "fuera de horario → derivado a humano" });
      return { done: true, outcome: "handed_off" };
    }
    note = OUT_OF_HOURS_NOTE;
  }

  const welcome = cfg.personality.welcomeMessage.trim();
  if (welcome && !state.welcomedAt) {
    await send(welcome, `welcome:${conv.id}`).catch((e) => log.warn("flow.welcome_failed", { runId: run.id, err: (e as Error).message }));
    state.welcomedAt = now.toISOString();
    await db.update(conversations).set({ botState: state }).where(eq(conversations.id, conv.id));
    await db.insert(flowRunSteps).values({ tenantId: run.tenantId, runId: run.id, nodeId: "guard", nodeType: "guard", status: "completed", summary: "bienvenida enviada" });
  }
  return { done: false, outOfHoursNote: note };
}

/**
 * Ejecuta (o reanuda) una ejecución. Concurrencia: se "reclama" la ejecución con un UPDATE
 * condicional; otro worker no puede tomarla a la vez. Errores transitorios se reintentan
 * desde el último paso persistido; agotados los reintentos se deriva a un humano.
 */
export async function executeRunJob(job: RunJob, attempt: number, maxAttempts: number) {
  const run0 = await db.query.flowRuns.findFirst({ where: eq(flowRuns.id, job.runId) });
  if (!run0 || ["completed", "failed", "cancelled", "handed_off"].includes(run0.status)) return { skipped: true };
  if (job.mode === "timeout" && (run0.status !== "waiting" || run0.stepCount !== job.expectStep)) return { skipped: true };
  const claimable = job.mode === "start" ? ["queued", "running"] : ["waiting", "running"];
  const claimed = await db
    .update(flowRuns)
    .set({ status: "running", attempts: sql`${flowRuns.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(flowRuns.id, run0.id), inArray(flowRuns.status, claimable as never)))
    .returning();
  if (claimed.length === 0) return { skipped: true };
  let run = claimed[0];
  let version = await db.query.botVersions.findFirst({ where: eq(botVersions.id, run.versionId) });
  let bot = await db.query.bots.findFirst({ where: eq(bots.id, run.botId) });
  if (!version || !bot) {
    await db.update(flowRuns).set({ status: "failed", lastError: "Versión inexistente", finishedAt: new Date() }).where(eq(flowRuns.id, run.id));
    return { skipped: true };
  }
  // versiones viejas (sin copia de configuración): se usan los productos asociados actuales
  const fallbackProducts = version.settings ? [] : (await db.select({ id: botProducts.productId }).from(botProducts).where(eq(botProducts.botId, bot.id))).map((r) => r.id);
  let settings = settingsFromVersion(bot, version.settings, fallbackProducts);
  const metrics: RunMetrics = { ...newMetrics(), ...((run.metrics ?? {}) as Partial<RunMetrics>) };
  const saveMetrics = () => db.update(flowRuns).set({ metrics: metrics as unknown as Record<string, unknown> }).where(eq(flowRuns.id, run.id));

  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, run.conversationId) });
  const contact = conv ? await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) }) : null;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, run.tenantId) });
  const horario = isWithinBusinessHours(tenant?.settings?.businessHours, tenant?.timezone ?? "America/Argentina/Buenos_Aires") ? "abierto" : "cerrado";
  const baseCtx = { lastMessage: "", vars: {}, ...(run.context as Partial<FlowContext>), contactName: contact?.name ?? null } as FlowContext;
  // variable de sistema disponible para condiciones: horario = abierto | cerrado
  const context: FlowContext = { ...baseCtx, vars: { ...baseCtx.vars, horario } };
  let graph = version.graph as FlowGraph;
  const currentIsWait = graph.nodes.find((n) => n.id === run.currentNodeId)?.type === "wait";
  const resumingMidway = attempt > 1 && run0.status === "running" && run.currentNodeId && !(currentIsWait && job.mode !== "start");
  let mode: "start" | "reply" | "timeout" | "continue" = resumingMidway ? "continue" : job.mode;
  // reintento de una ejecución que ya pasó a otro bot del equipo: arranca el flujo de ese bot
  if (mode === "reply" && metrics.routed && !run.currentNodeId) mode = "start";
  const finish = async (status: "handed_off" | "cancelled", reason: string | null) => {
    await db.update(flowRuns).set({ status, lastError: reason, finishedAt: new Date(), context: scrub(context), metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(flowRuns.id, run.id));
  };

  let result: { outcome: RunOutcome; state: { currentNodeId: string | null; context: FlowContext; stepCount: number } };
  try {
    // equipos de chatbots: insultos (suspende a todo el equipo) y derivación interna, una vez por mensaje
    let insultChecked = false;
    if (conv?.teamId && (mode === "start" || mode === "reply") && !metrics.routed) {
      insultChecked = true;
      if (await insultGuard(run, bot, settings, job.message ?? "", metrics)) {
        await finish("handed_off", metrics.handoffReason ?? null);
        return { outcome: "handed_off" };
      }
      const routing = await routeIncoming({
        tenantId: run.tenantId,
        conv,
        currentBotId: bot.id,
        message: job.message ?? "",
        runId: run.id,
        onAiUsage: (u) => {
          metrics.aiCalls++;
          metrics.inputTokens += u.inputTokens;
          metrics.outputTokens += u.outputTokens;
          metrics.latencyMs += u.latencyMs;
          metrics.tools = [...new Set([...metrics.tools, "route_ai"])];
        },
      });
      metrics.routed = true;
      if (routing.kind !== "none" && routing.kind !== "stale") {
        metrics.team = { intent: routing.route.intent, signals: routing.route.signals.slice(0, 5), hops: routing.route.hops.map((h) => ({ from: h.from, to: h.to, toHuman: h.toHuman, kind: h.kind, reason: h.reason.slice(0, 160) })), fromBotId: bot.id, aiUsed: routing.route.aiUsed };
      }
      if (routing.kind === "stale") {
        // otro mensaje o una persona cambió el bot activo mientras tanto: esta ejecución no responde
        await finish("cancelled", "El bot activo cambió durante la derivación");
        return { outcome: "cancelled" };
      }
      if (routing.kind === "human") {
        metrics.handoffCode = "team_route";
        metrics.handoffReason = routing.reason.slice(0, 200);
        await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: routing.reason, code: "team_route", config: settings.config, sendTransfer: true, data: { teamId: conv.teamId, kind: routing.route.hops[routing.route.hops.length - 1]?.kind } });
        await finish("handed_off", routing.reason.slice(0, 300));
        return { outcome: "handed_off" };
      }
      if ((routing.kind === "transfer" || routing.kind === "stay") && routing.botId && routing.bot && routing.settings && routing.versionId && routing.botId !== bot.id) {
        // la misma ejecución pasa al bot de destino (versión fijada por el equipo), desde el inicio
        const [moved] = await db
          .update(flowRuns)
          .set({ botId: routing.botId, versionId: routing.versionId, currentNodeId: null, stepCount: 0, context: { lastMessage: job.message ?? "", vars: {} }, metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(and(eq(flowRuns.id, run.id), eq(flowRuns.status, "running")))
          .returning();
        if (!moved) return { skipped: true };
        run = moved;
        bot = routing.bot;
        version = (await db.query.botVersions.findFirst({ where: eq(botVersions.id, routing.versionId) }))!;
        settings = routing.settings;
        graph = version.graph as FlowGraph;
        context.vars = { horario };
        context.lastMessage = job.message ?? "";
        mode = "start";
        // mensaje de transición configurado en la derivación (fijo, sin IA); por defecto es silenciosa
        const transition = routing.kind === "transfer" ? routing.route.hops.at(-1)?.message : undefined;
        if (transition) await sendOutbound({ tenantId: run.tenantId, actor: { kind: "bot", botId: routing.botId, runId: run.id } }, { conversationId: run.conversationId, text: transition, idempotencyKey: `transition:${run.id}`, origin: { botId: routing.botId, runId: run.id } }).catch((x) => log.warn("team.transition_message_failed", { runId: run.id, err: (x as Error).message }));
        const actions = routing.kind !== "transfer" ? [] : await applyTransferActions({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, settings, contactName: contact?.name ?? null });
        if (metrics.team) metrics.team.actions = actions;
      }
      await saveMetrics();
    }
    // reglas previas a la IA (una sola vez por mensaje; no en reintentos a mitad de camino)
    if (mode === "start" || mode === "reply") {
      const guard = await preAiGuards(run, bot, settings, mode, job.message ?? "", horario, metrics, insultChecked);
      if (guard.done) {
        await db.update(flowRuns).set({ status: "handed_off", lastError: metrics.handoffReason ?? null, finishedAt: new Date(), context: scrub(context), metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(flowRuns.id, run.id));
        return { outcome: guard.outcome };
      }
      if (guard.outOfHoursNote) context.vars.fuera_de_horario = "si";
    }
    const effects = makeRuntimeEffects(run, bot, settings, attempt, metrics);
    result = await runFlow(graph, { currentNodeId: run.currentNodeId, context, stepCount: run.stepCount }, effects, { mode, message: job.message, runKey: run.id });
  } catch (e) {
    const err = e as Error;
    const retryable = e instanceof FlowStepError ? e.retryable : true;
    await saveMetrics();
    if (retryable && attempt < Math.min(maxAttempts, settings.config.operation.retries)) {
      await db.update(flowRuns).set({ status: "running", lastError: err.message.slice(0, 300), updatedAt: new Date() }).where(eq(flowRuns.id, run.id));
      throw e; // el job se reintenta con backoff
    }
    // fallback: derivar a humano, sin respuestas duplicadas (mensaje fijo opcional, sin IA)
    const op = settings.config.operation;
    if (op.onFailure === "message_and_handoff" && op.failureMessage.trim()) {
      await sendOutbound({ tenantId: run.tenantId, actor: { kind: "bot", botId: bot.id, runId: run.id } }, { conversationId: run.conversationId, text: op.failureMessage.trim(), idempotencyKey: `failure:${run.id}`, origin: { botId: bot.id, runId: run.id } }).catch((x) => log.warn("flow.failure_message_failed", { runId: run.id, err: (x as Error).message }));
    }
    metrics.handoffCode = "error";
    metrics.handoffReason = err.message.slice(0, 200);
    await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: `Falla del bot: ${err.message}`.slice(0, 300), code: "error", config: settings.config, sendTransfer: true });
    await db.update(flowRuns).set({ status: "handed_off", lastError: err.message.slice(0, 300), finishedAt: new Date(), context: scrub(context), metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(flowRuns.id, run.id));
    log.warn("flow.fallback_handoff", { runId: run.id, err: err.message });
    return { outcome: "handed_off" };
  }
  const { outcome, state } = result;
  switch (outcome.status) {
    case "waiting":
      await db.update(flowRuns).set({ status: "waiting", resumeAt: outcome.resumeAt, context: state.context as unknown as Record<string, unknown>, metrics: metrics as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(flowRuns.id, run.id));
      await enqueue("flow.run", { runId: run.id, mode: "timeout", expectStep: state.stepCount }, { tenantId: run.tenantId, runAt: outcome.resumeAt, dedupKey: `timeout:${run.id}:${state.stepCount}`, maxAttempts: 3 });
      break;
    case "completed":
    case "handed_off":
    case "cancelled":
    case "failed":
      if (outcome.status === "failed") {
        metrics.handoffCode = "error";
        metrics.handoffReason = outcome.reason.slice(0, 200);
        await handoffWithPolicy({ tenantId: run.tenantId, conversationId: run.conversationId, botId: bot.id, runId: run.id, reason: outcome.reason, code: "error", config: settings.config, sendTransfer: true });
      }
      await db
        .update(flowRuns)
        .set({
          status: outcome.status === "failed" ? "failed" : outcome.status,
          lastError: "reason" in outcome ? outcome.reason.slice(0, 300) : null,
          finishedAt: new Date(),
          context: scrub(state.context),
          metrics: metrics as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(flowRuns.id, run.id));
      break;
  }
  return { outcome: outcome.status };
}
