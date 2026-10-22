import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { botTransfers, conversationActivity, conversations, flowRuns, opportunities } from "../db/schema";
import { log } from "../log";
import { isAssignableMember } from "../flows/settings";
import { loadTeamVersion, nodeOfBot, teamHelpers } from "./orchestrator";

export type AutomationEvent = { opportunityId: string; stageId: string; stageKind: "open" | "won" | "lost"; pipelineId: string };

/**
 * Automatizaciones del equipo disparadas por eventos del pipeline (etapa alcanzada, oportunidad
 * cerrada). Se aplican a la conversación del contacto que está atendida por un equipo, con la
 * versión del equipo fijada en esa conversación. Nunca retoman una conversación en manos de una
 * persona: activar un bot solo cambia el bot activo si la conversación sigue en modo bot.
 */
export async function runTeamAutomations(tenantId: string, ev: AutomationEvent) {
  const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.id, ev.opportunityId), eq(opportunities.tenantId, tenantId)) });
  if (!opp) return { applied: [] as string[] };
  const conv =
    (opp.conversationId ? await db.query.conversations.findFirst({ where: and(eq(conversations.id, opp.conversationId), eq(conversations.tenantId, tenantId)) }) : null) ??
    (await db.query.conversations.findFirst({ where: and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, opp.contactId)), orderBy: [desc(conversations.lastMessageAt)] }));
  if (!conv?.teamId || !conv.teamVersionId) return { applied: [] };
  const tv = await loadTeamVersion(tenantId, conv.teamVersionId);
  if (!tv) return { applied: [] };
  const h = teamHelpers(tv);
  const applied: string[] = [];
  const closed = ev.stageKind === "won" || ev.stageKind === "lost";

  for (const a of tv.graph.automations) {
    if (!a.enabled) continue;
    const t = a.trigger;
    const matches = (t.kind === "stage_entered" && t.stageId === ev.stageId) || (t.kind === "opportunity_closed" && closed && (!t.pipelineId || t.pipelineId === ev.pipelineId));
    if (!matches) continue;
    const fresh = await db.query.conversations.findFirst({ where: eq(conversations.id, conv.id) });
    if (!fresh || fresh.teamVersionId !== tv.id) break;
    const act = a.action;
    try {
      if (act.kind === "activate_bot") {
        const node = nodeOfBot(tv.graph, act.botId);
        if (!node || !h.isAvailable(node) || fresh.activeBotId === act.botId || fresh.attentionMode !== "bot") continue;
        const upd = await db
          .update(conversations)
          .set({ activeBotId: act.botId, botState: sql`coalesce(${conversations.botState}, '{}'::jsonb) - 'transferStreak' - 'transfer'`, updatedAt: new Date() })
          .where(and(eq(conversations.id, conv.id), eq(conversations.attentionMode, "bot"), fresh.activeBotId ? eq(conversations.activeBotId, fresh.activeBotId) : isNull(conversations.activeBotId)))
          .returning({ id: conversations.id });
        if (!upd.length) continue;
        // ejecuciones del bot anterior en curso ya no deben responder
        await db.update(flowRuns).set({ status: "cancelled", lastError: "Cambio de bot por automatización", finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "waiting"])));
        const reason = `Automatización: ${t.kind === "stage_entered" ? "la oportunidad llegó a una etapa" : "la oportunidad se cerró"} → ${h.nameOf(node)}`;
        await db.insert(botTransfers).values({ tenantId, conversationId: conv.id, teamId: tv.teamId, teamVersionId: tv.id, fromBotId: fresh.activeBotId, toBotId: act.botId, kind: "automation", reason });
        await db.insert(conversationActivity).values({ tenantId, conversationId: conv.id, kind: "bot_transfer", actorKind: "system", reason, data: { fromBotId: fresh.activeBotId, toBotId: act.botId, teamId: tv.teamId, kind: "automation", automationId: a.id } });
        applied.push(`activate_bot:${act.botId}`);
      } else if (act.kind === "stop_bot") {
        if (fresh.attentionMode !== "bot" || (act.botId && fresh.activeBotId !== act.botId)) continue;
        const upd = await db
          .update(conversations)
          .set({ attentionMode: "paused", updatedAt: new Date(), version: sql`${conversations.version} + 1` })
          .where(and(eq(conversations.id, conv.id), eq(conversations.attentionMode, "bot")))
          .returning({ id: conversations.id });
        if (!upd.length) continue;
        await db.update(flowRuns).set({ status: "cancelled", lastError: "Bot detenido por automatización", finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running", "waiting"])));
        const reason = `Automatización: ${closed ? `oportunidad ${ev.stageKind === "won" ? "ganada" : "perdida"}` : "etapa alcanzada"} → bot detenido`;
        await db.insert(botTransfers).values({ tenantId, conversationId: conv.id, teamId: tv.teamId, teamVersionId: tv.id, fromBotId: fresh.activeBotId, toBotId: null, kind: "automation", reason });
        await db.insert(conversationActivity).values({ tenantId, conversationId: conv.id, kind: "bot_paused", actorKind: "system", reason, data: { teamId: tv.teamId, automationId: a.id } });
        applied.push("stop_bot");
      } else if (act.kind === "assign_owner") {
        if (!(await isAssignableMember(tenantId, act.userId))) continue;
        const o = await db
          .update(opportunities)
          .set({ ownerUserId: act.userId, updatedAt: new Date(), version: sql`${opportunities.version} + 1` })
          .where(and(eq(opportunities.id, opp.id), isNull(opportunities.ownerUserId)))
          .returning({ id: opportunities.id });
        const c = await db.update(conversations).set({ assigneeUserId: act.userId, updatedAt: new Date() }).where(and(eq(conversations.id, conv.id), isNull(conversations.assigneeUserId))).returning({ id: conversations.id });
        if (c.length) await db.insert(conversationActivity).values({ tenantId, conversationId: conv.id, kind: "assigned", actorKind: "system", reason: "Automatización del equipo de chatbots", data: { to: act.userId, automationId: a.id } });
        if (o.length || c.length) applied.push("assign_owner");
      }
    } catch (e) {
      log.warn("team.automation_failed", { tenantId, automationId: a.id, err: (e as Error).message });
    }
  }
  return { applied };
}
