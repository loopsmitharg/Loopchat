import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { webhookEvents } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { audit } from "./audit";

export async function checkHealth() {
  const started = Date.now();
  const result: Record<string, unknown> = { app: "ok", time: new Date().toISOString() };
  try {
    await db.execute(sql`select 1`);
    result.database = "ok";
  } catch {
    result.database = "error";
  }
  const cw = process.env.CHATWOOT_BASE_URL;
  if (cw) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const r = await fetch(new URL("/api", cw), { signal: controller.signal, redirect: "manual" });
      result.chatwoot = r.status < 500 ? "ok" : `error_${r.status}`;
    } catch {
      result.chatwoot = "unreachable";
    } finally {
      clearTimeout(timer);
    }
  } else result.chatwoot = "not_configured";
  try {
    const q = await db.execute<{ queued: number; failed: number; oldest_seconds: number | null; stuck: number }>(sql`
      select count(*) filter (where status = 'queued' and run_at <= now())::int as queued,
             count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')::int as failed,
             extract(epoch from now() - min(run_at) filter (where status = 'queued' and run_at <= now()))::int as oldest_seconds,
             count(*) filter (where status = 'running' and locked_until < now())::int as stuck
      from jobs`);
    result.queue = q.rows[0];
  } catch {
    result.queue = "error";
  }
  result.latencyMs = Date.now() - started;
  const q = result.queue as { oldest_seconds: number | null } | string;
  const queueBehind = typeof q === "object" && (q.oldest_seconds ?? 0) > 300;
  result.status = result.database === "ok" && !queueBehind ? "ok" : "degraded";
  return result;
}

export async function platformOverview() {
  const rows = await db.execute<{ tenant_id: string; failed_events: number; failed_jobs: number; last_event_at: string | null; channels_error: number }>(sql`
    select t.id as tenant_id,
      (select count(*)::int from webhook_events w where w.tenant_id = t.id and w.status = 'failed') as failed_events,
      (select count(*)::int from jobs j where j.tenant_id = t.id and j.status = 'failed' and j.updated_at > now() - interval '7 days') as failed_jobs,
      (select max(received_at)::text from webhook_events w where w.tenant_id = t.id) as last_event_at,
      (select count(*)::int from channel_connections c where c.tenant_id = t.id and c.status = 'error') as channels_error
    from tenants t`);
  return rows.rows;
}

/** Reprocesa eventos fallidos de un tenant (idempotente). No expone contenido. */
export async function reprocessFailedEvents(tenantId: string, actorUserId: string) {
  const failed = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(and(eq(webhookEvents.tenantId, tenantId), eq(webhookEvents.status, "failed"))).limit(500);
  for (const f of failed) {
    await db.update(webhookEvents).set({ status: "received" }).where(eq(webhookEvents.id, f.id));
    await enqueue("chatwoot.event", { webhookEventId: f.id }, { tenantId, dedupKey: `evt:${f.id}:retry:${Date.now()}` });
  }
  await audit({ tenantId, actorUserId, actorKind: "platform", action: "ops.reprocess_failed_events", data: { count: failed.length } });
  return { requeued: failed.length };
}

export async function requestReconcile(tenantId: string, actorUserId: string | null) {
  await enqueue("chatwoot.reconcile_account", {}, { tenantId, dedupKey: `reconcile:${tenantId}:${Math.floor(Date.now() / 60000)}` });
  await audit({ tenantId, actorUserId, actorKind: actorUserId ? "platform" : "system", action: "ops.reconcile_requested" });
}

/** Retención: borra payloads de webhooks procesados viejos (minimización de datos). */
export async function purgeOldWebhookPayloads(days = 30) {
  const r = await db.execute(sql`update webhook_events set payload = null where status in ('processed','ignored') and received_at < now() - (${days} || ' days')::interval and payload is not null`);
  await db.execute(sql`delete from jobs where status = 'done' and updated_at < now() - interval '7 days'`);
  await db.execute(sql`delete from rate_limits where window_start < extract(epoch from now())::bigint - 3600`);
  return { purged: r.rowCount ?? 0 };
}
