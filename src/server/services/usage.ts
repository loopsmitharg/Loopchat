import "server-only";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { OPERATIONAL_STATUSES } from "@/lib/plans";
import { db, type Tx } from "../db";
import {
  aiProviderConnections,
  bots,
  channelConnections,
  memberships,
  pipelines,
  plans,
  subscriptions,
  tenants,
  usageCounters,
  usageEvents,
  type PlanLimits,
} from "../db/schema";
import { policyBlocked, quotaExceeded } from "../http/errors";
import { audit } from "./audit";

export function currentPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export type TenantPlanState = {
  tenantStatus: "active" | "suspended";
  subscriptionStatus: string;
  planCode: string;
  planName: string;
  limits: PlanLimits;
};

export async function getPlanState(tenantId: string, runner: Tx | typeof db = db): Promise<TenantPlanState> {
  const rows = await runner
    .select({
      tenantStatus: tenants.status,
      subscriptionStatus: subscriptions.status,
      planCode: plans.code,
      planName: plans.name,
      limits: plans.limits,
      overrides: subscriptions.limitOverrides,
    })
    .from(tenants)
    .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const r = rows[0];
  if (!r) throw policyBlocked("La empresa no tiene una suscripción configurada.");
  return {
    tenantStatus: r.tenantStatus,
    subscriptionStatus: r.subscriptionStatus,
    planCode: r.planCode,
    planName: r.planName,
    limits: { ...r.limits, ...(r.overrides ?? {}) },
  };
}

export function isOperational(state: Pick<TenantPlanState, "tenantStatus" | "subscriptionStatus">) {
  return state.tenantStatus === "active" && OPERATIONAL_STATUSES.has(state.subscriptionStatus);
}

/** Bloquea acciones nuevas (envíos, bots, altas) si la empresa está suspendida/cancelada. Lectura siempre permitida. */
export async function assertOperational(tenantId: string, runner: Tx | typeof db = db) {
  const state = await getPlanState(tenantId, runner);
  if (!isOperational(state)) {
    throw policyBlocked(
      "La cuenta de la empresa está suspendida o cancelada: podés consultar el historial pero no ejecutar acciones nuevas. Contactá a Loop Smiths.",
      { reason: "subscription_inactive", status: state.subscriptionStatus },
    );
  }
  return state;
}

export type CountableResource = "whatsappNumbers" | "agents" | "pipelines" | "activeBots";

async function countResource(tx: Tx, tenantId: string, resource: CountableResource): Promise<number> {
  switch (resource) {
    case "whatsappNumbers": {
      const [r] = await tx
        .select({ n: count() })
        .from(channelConnections)
        .where(and(eq(channelConnections.tenantId, tenantId), ne(channelConnections.status, "disconnected")));
      return r.n;
    }
    case "agents": {
      const [r] = await tx
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")));
      return r.n;
    }
    case "pipelines": {
      const [r] = await tx.select({ n: count() }).from(pipelines).where(eq(pipelines.tenantId, tenantId));
      return r.n;
    }
    case "activeBots": {
      // bots activos individualmente + bots de equipos activos (cada bot cuenta una sola vez)
      const [r] = await tx
        .select({ n: count() })
        .from(bots)
        .where(
          and(
            eq(bots.tenantId, tenantId),
            sql`(${bots.status} = 'active' or exists (select 1 from bot_team_members m join bot_teams t on t.id = m.team_id where m.bot_id = ${bots.id} and t.status = 'active'))`,
          ),
        );
      return r.n;
    }
  }
}

const RESOURCE_MESSAGES: Record<CountableResource, string> = {
  whatsappNumbers: "Alcanzaste el máximo de números de WhatsApp de tu plan.",
  agents: "Alcanzaste el máximo de usuarios de tu plan.",
  pipelines: "Alcanzaste el máximo de pipelines de tu plan.",
  activeBots: "Alcanzaste el máximo de bots activos de tu plan.",
};

/**
 * Verifica (dentro de una transacción) que crear `adding` unidades del recurso no supere el plan.
 * Bloquea la fila de suscripción con FOR UPDATE para serializar altas concurrentes del mismo tenant.
 */
export async function countActiveBots(tx: Tx, tenantId: string) {
  return countResource(tx, tenantId, "activeBots");
}

/** Verifica que el total resultante de bots activos (calculado por quien llama) no supere el plan. */
export async function assertActiveBotsTotal(tx: Tx, tenantId: string, total: number) {
  await tx.execute(sql`select id from subscriptions where tenant_id = ${tenantId} for update`);
  const state = await assertOperational(tenantId, tx);
  const limit = state.limits.activeBots;
  if (limit === null || limit === undefined) return;
  if (total > limit) {
    await audit({ tenantId, actorKind: "system", action: "quota.blocked", data: { resource: "activeBots", used: total, limit } }, tx);
    throw quotaExceeded(RESOURCE_MESSAGES.activeBots, { resource: "activeBots", used: total, limit });
  }
}

export async function assertResourceQuota(tx: Tx, tenantId: string, resource: CountableResource, adding = 1) {
  await tx.execute(sql`select id from subscriptions where tenant_id = ${tenantId} for update`);
  const state = await assertOperational(tenantId, tx);
  const limit = state.limits[resource];
  if (limit === null || limit === undefined) return;
  const used = await countResource(tx, tenantId, resource);
  if (used + adding > limit) {
    await audit({ tenantId, actorKind: "system", action: "quota.blocked", data: { resource, used, limit } }, tx);
    throw quotaExceeded(RESOURCE_MESSAGES[resource], { resource, used, limit });
  }
}

export type AiReservation =
  | { ok: true; eventId: string; duplicate: boolean }
  | { ok: false; reason: "quota_exceeded" | "inactive"; limit?: number; used?: number };

/**
 * Reserva atómica e idempotente de una llamada a IA. La llamada cuenta como uso al iniciarse.
 * - misma idempotencyKey ⇒ no vuelve a contar (duplicate=true)
 * - el contador solo se incrementa si queda cupo (UPDATE condicional), seguro ante concurrencia.
 */
export async function reserveAiCall(tenantId: string, idempotencyKey: string, meta: { provider: string; model: string }): Promise<AiReservation> {
  return db.transaction(async (tx) => {
    const state = await getPlanState(tenantId, tx);
    if (!isOperational(state)) return { ok: false, reason: "inactive" } as const;
    const period = currentPeriod();
    const inserted = await tx
      .insert(usageEvents)
      .values({ tenantId, metric: "ai_calls", period, idempotencyKey, outcome: "reserved", provider: meta.provider, model: meta.model })
      .onConflictDoNothing()
      .returning({ id: usageEvents.id });
    if (inserted.length === 0) {
      const existing = await tx.query.usageEvents.findFirst({
        where: and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.idempotencyKey, idempotencyKey)),
      });
      if (existing?.outcome === "blocked") return { ok: false, reason: "quota_exceeded" } as const;
      return { ok: true, eventId: existing!.id, duplicate: true } as const;
    }
    const limit = state.limits.aiCallsPerMonth;
    const res = await tx.execute<{ value: number }>(sql`
      insert into usage_counters (tenant_id, period, metric, value) values (${tenantId}, ${period}, 'ai_calls', 1)
      on conflict (tenant_id, period, metric) do update set value = usage_counters.value + 1, updated_at = now()
      where usage_counters.value < ${limit}
      returning value`);
    if (res.rows.length === 0 || limit <= 0) {
      if (res.rows.length > 0) {
        // limit <= 0: revertir el alta recién creada
        await tx.execute(sql`update usage_counters set value = value - 1 where tenant_id = ${tenantId} and period = ${period} and metric = 'ai_calls'`);
      }
      await tx.update(usageEvents).set({ outcome: "blocked", detail: "quota_exceeded", updatedAt: new Date() }).where(eq(usageEvents.id, inserted[0].id));
      await audit({ tenantId, actorKind: "system", action: "quota.blocked", data: { resource: "aiCallsPerMonth", limit } }, tx);
      return { ok: false, reason: "quota_exceeded", limit } as const;
    }
    return { ok: true, eventId: inserted[0].id, duplicate: false } as const;
  });
}

export async function completeAiCall(eventId: string, outcome: "success" | "failure", info: { inputTokens?: number; outputTokens?: number; detail?: string } = {}) {
  await db
    .update(usageEvents)
    .set({ outcome, inputTokens: info.inputTokens, outputTokens: info.outputTokens, detail: info.detail?.slice(0, 300), updatedAt: new Date() })
    .where(eq(usageEvents.id, eventId));
}

/** Contador informativo idempotente (p. ej. mensajes), sin tope. */
export async function recordUsage(tenantId: string, metric: string, idempotencyKey: string, runner: Tx | typeof db = db) {
  const period = currentPeriod();
  const inserted = await runner
    .insert(usageEvents)
    .values({ tenantId, metric, period, idempotencyKey, outcome: "success" })
    .onConflictDoNothing()
    .returning({ id: usageEvents.id });
  if (inserted.length === 0) return false;
  await runner.execute(sql`
    insert into usage_counters (tenant_id, period, metric, value) values (${tenantId}, ${period}, ${metric}, 1)
    on conflict (tenant_id, period, metric) do update set value = usage_counters.value + 1, updated_at = now()`);
  return true;
}

export async function getUsageSummary(tenantId: string) {
  const period = currentPeriod();
  const state = await getPlanState(tenantId);
  const counters = await db
    .select({ metric: usageCounters.metric, value: usageCounters.value })
    .from(usageCounters)
    .where(and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.period, period)));
  const byMetric = Object.fromEntries(counters.map((c) => [c.metric, c.value]));
  const resources = await db.transaction(async (tx) => ({
    whatsappNumbers: await countResource(tx, tenantId, "whatsappNumbers"),
    agents: await countResource(tx, tenantId, "agents"),
    pipelines: await countResource(tx, tenantId, "pipelines"),
    activeBots: await countResource(tx, tenantId, "activeBots"),
  }));
  const [aiFail] = await db
    .select({ n: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.period, period), eq(usageEvents.metric, "ai_calls"), inArray(usageEvents.outcome, ["failure"])));
  const [aiConns] = await db.select({ n: count() }).from(aiProviderConnections).where(and(eq(aiProviderConnections.tenantId, tenantId), ne(aiProviderConnections.status, "revoked")));
  return {
    period,
    plan: state,
    operational: isOperational(state),
    usage: {
      ...resources,
      aiCalls: byMetric["ai_calls"] ?? 0,
      aiCallFailures: aiFail.n,
      messagesIn: byMetric["messages_in"] ?? 0,
      messagesOut: byMetric["messages_out"] ?? 0,
      aiConnections: aiConns.n,
    },
  };
}
