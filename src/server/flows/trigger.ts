import "server-only";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { botTeams, bots, conversations, flowRuns } from "../db/schema";
import { botOfNode, loadTeamVersion, pinConversationToTeam, selectTeamForConversation } from "../teams/orchestrator";
import { enqueue } from "../jobs/queue";
import { getPlanState, isOperational } from "../services/usage";

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

/**
 * Disparo por mensaje entrante (idempotente por mensaje): reanuda una ejecución que espera
 * respuesta o crea una nueva sobre la versión publicada del bot.
 */
export async function triggerBotForIncoming(input: { tenantId: string; conversationId: string; chatwootMessageId: number; text: string; hasAttachments?: boolean }) {
  const plan = await getPlanState(input.tenantId);
  if (!isOperational(plan)) return { started: false, reason: "inactive" };
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)) });
  if (!conv || conv.attentionMode !== "bot") return { started: false, reason: "not_bot" };
  const message = input.text || (input.hasAttachments ? "(el cliente envió un adjunto)" : "");

  const waiting = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.conversationId, conv.id), eq(flowRuns.status, "waiting")) });
  if (waiting) {
    await enqueue("flow.run", { runId: waiting.id, mode: "reply", message }, { tenantId: input.tenantId, dedupKey: `reply:${waiting.id}:${input.chatwootMessageId}`, maxAttempts: 3 });
    return { started: true, runId: waiting.id, resumed: true };
  }
  // no iniciar otra ejecución si hay una en curso para la conversación (evita respuestas cruzadas)
  const active = await db.query.flowRuns.findFirst({ where: and(eq(flowRuns.tenantId, input.tenantId), eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running"])) });
  if (active) return { started: false, reason: "busy" };

  const target = await resolveTarget(input.tenantId, conv);
  if (!target) return { started: false, reason: "no_bot" };
  const [run] = await db
    .insert(flowRuns)
    .values({ tenantId: input.tenantId, botId: target.botId, versionId: target.versionId, conversationId: conv.id, triggerKey: `msg:${input.chatwootMessageId}`, status: "queued", context: { lastMessage: message, vars: {} } })
    .onConflictDoNothing()
    .returning();
  if (!run) return { started: false, reason: "duplicate" };
  await enqueue("flow.run", { runId: run.id, mode: "start", message }, { tenantId: input.tenantId, dedupKey: `start:${run.id}`, maxAttempts: 3 });
  return { started: true, runId: run.id };
}
