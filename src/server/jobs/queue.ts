import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { jobs } from "../db/schema";
import { log } from "../log";

export type JobKind =
  | "chatwoot.event"
  | "chatwoot.reconcile_status"
  | "chatwoot.reconcile_account"
  | "flow.run"
  | "flow.resume"
  | "team.automation";

export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown>,
  opts: { tenantId?: string | null; dedupKey?: string; runAt?: Date; maxAttempts?: number } = {},
  runner: Tx | typeof db = db,
) {
  const inserted = await runner
    .insert(jobs)
    .values({ kind, payload, tenantId: opts.tenantId ?? null, dedupKey: opts.dedupKey, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  if (inserted.length > 0 && process.env.LOOPCHAT_INLINE_WORKER === "true") {
    // procesamiento en el mismo proceso (desarrollo): no bloquea la respuesta HTTP
    setTimeout(() => {
      void import("./worker").then((w) => w.drainOnce()).catch((e) => log.error("inline_worker.error", { err: e }));
    }, 0);
  }
  return inserted[0]?.id ?? null;
}

export type ClaimedJob = { id: string; kind: JobKind; payload: Record<string, unknown>; tenantId: string | null; attempts: number; maxAttempts: number };

/** Toma trabajos vencidos con bloqueo optimista (SKIP LOCKED): seguro con varios workers. */
export async function claimJobs(limit = 10, lockSeconds = 120): Promise<ClaimedJob[]> {
  const res = await db.execute<{ id: string; kind: JobKind; payload: Record<string, unknown>; tenant_id: string | null; attempts: number; max_attempts: number }>(sql`
    update jobs set status = 'running', attempts = attempts + 1, locked_until = now() + (${lockSeconds} || ' seconds')::interval, updated_at = now()
    where id in (
      select id from jobs
      where (status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now())
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id, kind, payload, tenant_id, attempts, max_attempts`);
  return res.rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, tenantId: r.tenant_id, attempts: r.attempts, maxAttempts: r.max_attempts }));
}

export async function completeJob(id: string) {
  await db.execute(sql`update jobs set status = 'done', locked_until = null, last_error = null, updated_at = now() where id = ${id}`);
}

export async function failJob(job: ClaimedJob, error: string, retryable = true) {
  const final = !retryable || job.attempts >= job.maxAttempts;
  const backoffSec = Math.min(5 * 2 ** (job.attempts - 1), 600);
  await db.execute(sql`
    update jobs set status = ${final ? "failed" : "queued"}, last_error = ${error.slice(0, 500)},
      run_at = now() + (${backoffSec} || ' seconds')::interval, locked_until = null, updated_at = now()
    where id = ${job.id}`);
  return final;
}
