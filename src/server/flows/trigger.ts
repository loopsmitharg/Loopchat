import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { botTeams, botVersions, bots, conversations, flowRuns, type PendingBotMessage } from "../db/schema";
import { botOfNode, loadTeamVersion, pinConversationToTeam, selectTeamForConversation } from "../teams/orchestrator";
import { enqueue } from "../jobs/queue";
import { log } from "../log";
import { getPlanState, isOperational } from "../services/usage";
import { matchesAnyKeyword } from "./interpreter";
import { checkInsult, handoffWithPolicy, type HandoffCode } from "./policy";
import { settingsFromVersion } from "./settings";

/** Elige el bot activo con versión publicada que aplica al número de la conversación. */
export async function selectBotForConversation(tenantId: string, channelConnectionId: string | null) {
  const candidates = await db
    .select()
    .from(bots)
    .where(and(eq(bots.tenantId, tenantId), eq(bots.status, "active"), channelConnectionId ? or(eq(bots.channelConnectionId, channelConnectionId), isNull(bots.channelConnectionId)) : isNull(bots.channelConnectionId)))
    .orderBy(desc(bots.updatedAt));
  const withVersion = candidates.filter((b) => b.publishedVersionId);
  return withVersion.find((b) => b.channelConnectionId === channelConnectionId) ?? withVersion[0] ?? null;
}

/**
 * Qué atiende la conversación:
 * - fijada a un equipo activo → el bot activo con la versión fijada en esa versión del equipo
 *   (si ya no existe, el bot de entrada; el motor de derivación lo registra);
 * - sin equipo → equipo activo del número o bot individual (el específico del número tiene
 *   prioridad; a igual alcance, el equipo).
 */
async function resolveTarget(tenantId: string, conv: typeof conversations.$inferSelect): Promise<{ botId: string; versionId: string } | null> {
  let current = conv;
  if (current.teamId) {
    const team = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, current.teamId), eq(botTeams.tenantId, tenantId)) });
    if (!team || team.status !== "active" || !current.teamVersionId) {
      // equipo desactivado o eliminado: la conversación vuelve a la selección normal
      await db.update(conversations).set({ teamId: null, teamVersionId: null, activeBotId: null }).where(and(eq(conversations.id, conv.id), eq(conversations.teamId, current.teamId)));
      current = { ...current, teamId: null, teamVersionId: null, activeBotId: null };
    }
  }
  if (!current.teamId) {
    const team = await selectTeamForConversation(tenantId, current.channelConnectionId);
    const bot = await selectBotForConversation(tenantId, current.channelConnectionId);
    const useTeam = team && (!bot || team.channelConnectionId === current.channelConnectionId || bot.channelConnectionId !== current.channelConnectionId);
    if (!useTeam) return bot?.publishedVersionId ? { botId: bot.id, versionId: bot.publishedVersionId } : null;
    const pinned = await pinConversationToTeam(tenantId, current, team!);
    if (!pinned?.teamVersionId) return bot?.publishedVersionId ? { botId: bot.id, versionId: bot.publishedVersionId } : null;
    current = pinned;
  }
  const tv = await loadTeamVersion(tenantId, current.teamVersionId!);
  if (!tv) return null;
  // bot activo; si ya no existe en la versión fijada, el bot de entrada (el motor registra la vuelta)
  const chosen = current.activeBotId && tv.bots.has(current.activeBotId) ? current.activeBotId : botOfNode(tv.graph, tv.graph.settings.entryNodeId);
  const pin = chosen ? tv.bots.get(chosen) : undefined;
  return pin ? { botId: chosen!, versionId: pin.versionId } : null;
}

export type IncomingInput = { tenantId: string; conversationId: string; chatwootMessageId: number; text: string; hasAttachments?: boolean };

const messageIdOfTrigger = (triggerKey: string) => Number(triggerKey.match(/^msg:(\d+)$/)?.[1] ?? 0);

/**
 * Guardas determinísticas de un mensaje que llegó mientras el bot procesaba otro (sin IA):
 * palabras de derivación del bot, insultos y derivaciones a persona por palabra clave del equipo.
 * Si alguna aplica, deriva ya: cancela la ejecución en curso (su respuesta tardía se descarta).
 */
async function busyGuards(input: IncomingInput, conv: typeof conversations.$inferSelect, run: typeof flowRuns.$inferSelect, message: string) {
  const [bot, version] = await Promise.all([
    db.query.bots.findFirst({ where: and(eq(bots.id, run.botId), eq(bots.tenantId, input.tenantId)) }),
    db.query.botVersions.findFirst({ where: and(eq(botVersions.id, run.versionId), eq(botVersions.tenantId, input.tenantId)) }),
  ]);
  if (!bot || !version) return false;
  const settings = settingsFromVersion(bot, version.settings);
  let hit: { code: HandoffCode; reason: string; data?: Record<string, unknown> } | null = null;
  const insult = await checkInsult(input.tenantId, settings.config, message);
  if (insult.flagged) hit = { code: "insult_detection", reason: "Se detectó lenguaje ofensivo en el mensaje del cliente", data: { languages: [...new Set(insult.matches.map((m) => m.lang))] } };
  else if (matchesAnyKeyword(message, settings.handoffKeywords)) hit = { code: "keyword", reason: "El cliente pidió hablar con una persona" };
  else if (conv.teamVersionId) {
    const tv = await loadTeamVersion(input.tenantId, conv.teamVersionId);
    const human = new Set(tv?.graph.nodes.filter((n) => n.type === "human").map((n) => n.id) ?? []);
    const kw = (tv?.graph.edges ?? []).filter((e) => e.data.enabled && human.has(e.target) && e.data.condition.kind === "keywords").flatMap((e) => (e.data.condition as { keywords?: string[] }).keywords ?? []);
    if (matchesAnyKeyword(message, kw)) hit = { code: "team_route", reason: "El cliente pidió hablar con una persona" };
  }
  if (!hit) return false;
  // runId null: cancela TODAS las ejecuciones activas (también la que está generando una respuesta)
  await handoffWithPolicy({ tenantId: input.tenantId, conversationId: conv.id, botId: run.botId, runId: null, reason: hit.reason, code: hit.code, config: settings.config, sendTransfer: true, data: { ...(hit.data ?? {}), duringRun: run.id }, transferKey: `handoff:msg:${input.chatwootMessageId}` });
  // trazabilidad en Ejecuciones: el mensaje quedó atendido por la guarda, sin IA
  await db
    .insert(flowRuns)
    .values({ tenantId: input.tenantId, botId: run.botId, versionId: run.versionId, conversationId: conv.id, triggerKey: `msg:${input.chatwootMessageId}`, status: "handed_off", lastError: hit.reason, finishedAt: new Date(), context: {}, metrics: { aiCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, tools: [], blocked: [], products: [], guard: "busy_guard", handoffCode: hit.code, handoffReason: hit.reason } })
    .onConflictDoNothing();
  return true;
}

/**
 * Guarda el mensaje como pendiente de la conversación (el más reciente gana: los anteriores ya están
 * en el historial que recibe la IA). Mensajes viejos que llegan fuera de orden no pisan uno más nuevo.
 */
async function parkPending(conversationId: string, p: PendingBotMessage) {
  await db.execute(sql`
    update conversations set pending_bot_message = ${JSON.stringify(p)}::jsonb
    where id = ${conversationId}
      and (pending_bot_message is null or (pending_bot_message->>'chatwootMessageId')::bigint < ${p.chatwootMessageId})`);
}

/** Toma (y borra) atómicamente el mensaje pendiente: solo un proceso lo procesa. */
async function claimPending(conversationId: string): Promise<PendingBotMessage | null> {
  const r = await db.execute<{ p: PendingBotMessage }>(sql`
    update conversations c set pending_bot_message = null
    from (select id, pending_bot_message as p from conversations where id = ${conversationId} and pending_bot_message is not null for update) old
    where c.id = old.id
    returning old.p as p`);
  return r.rows[0]?.p ?? null;
}

/**
 * Al terminar una ejecución: si llegó un mensaje mientras trabajaba, se procesa ahora.
 * Debe llamarse DESPUÉS de dejar la ejecución en un estado final o en espera.
 */
export async function drainPendingMessage(tenantId: string, conversationId: string) {
  const p = await claimPending(conversationId);
  if (!p) return null;
  return triggerBotForIncoming({ tenantId, conversationId, chatwootMessageId: p.chatwootMessageId, text: p.text, hasAttachments: p.hasAttachments });
}

/**
 * Disparo por mensaje entrante (idempotente por mensaje). Ningún mensaje se pierde:
 * - ejecución esperando respuesta → se reanuda con este mensaje;
 * - ejecución en curso → guardas determinísticas YA (derivación, insultos) y, si no aplican, el
 *   mensaje queda pendiente y se procesa al terminar la ejecución actual;
 * - sin ejecución → nueva ejecución sobre la versión publicada (una sola activa por conversación,
 *   garantizado por índice único).
 */
export async function triggerBotForIncoming(input: IncomingInput): Promise<{ started: boolean; reason?: string; runId?: string; resumed?: boolean }> {
  const plan = await getPlanState(input.tenantId);
  if (!isOperational(plan)) return { started: false, reason: "inactive" };
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)) });
  if (!conv || conv.attentionMode !== "bot") return { started: false, reason: "not_bot" };
  const message = input.text || (input.hasAttachments ? "(el cliente envió un adjunto)" : "");
  const pending: PendingBotMessage = { chatwootMessageId: input.chatwootMessageId, text: input.text, hasAttachments: Boolean(input.hasAttachments), at: new Date().toISOString() };

  const waiting = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.conversationId, conv.id), eq(flowRuns.status, "waiting")) });
  if (waiting) {
    await enqueue("flow.run", { runId: waiting.id, mode: "reply", message, messageId: input.chatwootMessageId, hasAttachments: Boolean(input.hasAttachments) }, { tenantId: input.tenantId, dedupKey: `reply:${waiting.id}:${input.chatwootMessageId}`, maxAttempts: 3 });
    return { started: true, runId: waiting.id, resumed: true };
  }

  const active = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])) });
  if (active) return onBusy(input, conv, active, message, pending);

  const target = await resolveTarget(input.tenantId, conv);
  if (!target) return { started: false, reason: "no_bot" };
  // inserción de la ejecución y su trabajo en la misma transacción (no quedan ejecuciones huérfanas)
  const run = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(flowRuns)
      .values({ tenantId: input.tenantId, botId: target.botId, versionId: target.versionId, conversationId: conv.id, triggerKey: `msg:${input.chatwootMessageId}`, status: "queued", context: { lastMessage: message, vars: {} } })
      .onConflictDoNothing()
      .returning();
    if (r) await enqueue("flow.run", { runId: r.id, mode: "start", message }, { tenantId: input.tenantId, dedupKey: `start:${r.id}`, maxAttempts: 3 }, tx);
    return r ?? null;
  });
  if (run) return { started: true, runId: run.id };
  // conflicto: mismo mensaje ya disparado, u otra ejecución activa que ganó la carrera
  const existing = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.triggerKey, `msg:${input.chatwootMessageId}`)) });
  if (existing) return { started: false, reason: "duplicate" };
  const winner = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])) });
  if (winner) return onBusy(input, conv, winner, message, pending);
  return { started: false, reason: "duplicate" };
}

async function onBusy(input: IncomingInput, conv: typeof conversations.$inferSelect, active: typeof flowRuns.$inferSelect, message: string, pending: PendingBotMessage) {
  // reintento del mismo mensaje que originó la ejecución activa
  if (active.triggerKey === `msg:${input.chatwootMessageId}`) return { started: false, reason: "duplicate" };
  if (await busyGuards(input, conv, active, message)) return { started: false, reason: "handed_off" };
  // un mensaje más viejo que el que ya se está procesando llegó tarde: ya está en el historial
  if (input.chatwootMessageId <= messageIdOfTrigger(active.triggerKey)) return { started: false, reason: "stale" };
  await parkPending(conv.id, pending);
  // si la ejecución terminó entre la consulta y el guardado, nadie más va a tomar el pendiente: tomarlo acá
  const still = await db.query.flowRuns.findFirst({ columns: { id: true }, where: and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])) });
  if (!still) {
    const r = await drainPendingMessage(input.tenantId, conv.id);
    if (r) return r;
  }
  log.info("flow.message_pending", { tenantId: input.tenantId, conversationId: conv.id, runId: active.id });
  return { started: false, reason: "pending" };
}
