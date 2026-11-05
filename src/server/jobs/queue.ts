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

export type ClaimedJob = { id: string; kind: JobKind; payload: Record<string, unknown>; tenantId: string | null; attempts: number; maxAttempts: number; owner: string };

/**
 * Toma trabajos vencidos con lease (`locked_by` + `locked_until`) y SKIP LOCKED: seguro con varios workers.
 * Equidad: ninguna empresa supera `perTenant` ejecuciones de bots en curso (las lentas: llamadas a IA),
 * contando las de TODOS los workers; así una empresa con mucho volumen o un proveedor lento no
 * monopoliza la cola. Los eventos de webhook (rápidos) no tienen tope: una derivación urgente no espera.
 * Un trabajo `running` solo se retoma si su lease venció (proceso caído); el dueño lo renueva con `renewLeases`.
 */
export async function claimJobs(owner: string, limit: number, opts: { lockSeconds?: number; perTenant?: number } = {}): Promise<ClaimedJob[]> {
  if (limit <= 0) return [];
  const lockSeconds = opts.lockSeconds ?? 120;
  const perTenant = opts.perTenant ?? 2;
  const res = await db.execute<{ id: string; kind: JobKind; payload: Record<string, unknown>; tenant_id: string | null; attempts: number; max_attempts: number }>(sql`
    with busy as (
      select tenant_id, count(*)::int as n from jobs where kind = 'flow.run' and status = 'running' and locked_until >= now() group by tenant_id
    ), ready as (
      select j.id, j.kind, j.run_at, row_number() over (partition by j.tenant_id, j.kind = 'flow.run' order by j.run_at, j.id) as rn, coalesce(b.n, 0) as running
      from jobs j left join busy b on b.tenant_id is not distinct from j.tenant_id
      where (j.status = 'queued' and j.run_at <= now()) or (j.status = 'running' and j.locked_until < now())
    ), picked as (
      select id from ready where kind <> 'flow.run' or rn + running <= ${perTenant} order by run_at limit ${limit * 3}
    )
    update jobs set status = 'running', attempts = attempts + 1, locked_by = ${owner},
      locked_until = now() + (${lockSeconds} || ' seconds')::interval, updated_at = now()
    where id in (
      select id from jobs
      where id in (select id from picked)
        and ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id, kind, payload, tenant_id, attempts, max_attempts`);
  return res.rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, tenantId: r.tenant_id, attempts: r.attempts, maxAttempts: r.max_attempts, owner }));
}

/** Renueva el lease de los trabajos (y sus ejecuciones de bot) que este worker sigue procesando. */
export async function renewLeases(owner: string, jobIds: string[], lockSeconds = 120) {
  if (!jobIds.length) return;
  await db.execute(sql`
    update jobs set locked_until = now() + (${lockSeconds} || ' seconds')::interval
    where locked_by = ${owner} and status = 'running' and id in (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await db.execute(sql`
    update flow_runs set lease_until = now() + (${lockSeconds} || ' seconds')::interval
    where status = 'running' and lease_owner in (${sql.join(jobIds.map((id) => sql`${`${owner}:${id}`}`), sql`, `)})`);
}

/** Fencing: solo el dueño vigente del lease puede cerrar el trabajo (otro worker pudo haberlo retomado). */
export async function completeJob(job: Pick<ClaimedJob, "id" | "owner">) {
  const r = await db.execute(sql`update jobs set status = 'done', locked_until = null, last_error = null, updated_at = now() where id = ${job.id} and locked_by = ${job.owner} and status = 'running'`);
  return (r.rowCount ?? 0) > 0;
}

export async function failJob(job: ClaimedJob, error: string, retryable = true) {
  const final = !retryable || job.attempts >= job.maxAttempts;
  const backoffSec = Math.min(5 * 2 ** (job.attempts - 1), 600);
  await db.execute(sql`
    update jobs set status = ${final ? "failed" : "queued"}, last_error = ${error.slice(0, 500)},
      run_at = now() + (${backoffSec} || ' seconds')::interval, locked_until = null, locked_by = null, updated_at = now()
    where id = ${job.id} and locked_by = ${job.owner} and status = 'running'`);
  return final;
}
