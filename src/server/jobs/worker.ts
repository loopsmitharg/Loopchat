import "server-only";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { log } from "../log";
import { claimJobs, completeJob, failJob, renewLeases, type ClaimedJob } from "./queue";

/** Identidad de este proceso para los leases (fencing entre workers). */
export const WORKER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Math.floor(Number(v)) : d);
/** Trabajos simultáneos por proceso (llamadas a IA y a Chatwoot son I/O: la concurrencia no compite por CPU). */
export const workerConcurrency = () => num(process.env.WORKER_CONCURRENCY, 8);
/** Máximo de trabajos en curso de una misma empresa (entre todos los workers): equidad entre empresas. */
export const tenantConcurrency = () => num(process.env.WORKER_TENANT_CONCURRENCY, 2);
const POLL_MS = 200;
const leaseSeconds = () => num(process.env.WORKER_LEASE_SECONDS, 120);

async function handle(job: ClaimedJob) {
  switch (job.kind) {
    case "chatwoot.event": {
      const { processWebhookEvent } = await import("../chatwoot/sync");
      await processWebhookEvent(String(job.payload.webhookEventId));
      return;
    }
    case "chatwoot.reconcile_status": {
      const { reconcileMessageStatuses } = await import("../chatwoot/sync");
      await reconcileMessageStatuses(job.tenantId!, String(job.payload.conversationId));
      return;
    }
    case "chatwoot.reconcile_account": {
      const { reconcileAccount } = await import("../chatwoot/sync");
      await reconcileAccount(job.tenantId!);
      return;
    }
    case "flow.run":
    case "flow.resume": {
      const { executeRunJob } = await import("../flows/runtime");
      await executeRunJob(job.payload as never, job.attempts, job.maxAttempts, { owner: `${job.owner}:${job.id}` });
      return;
    }
    case "team.automation": {
      const { runTeamAutomations } = await import("../teams/automations");
      await runTeamAutomations(job.tenantId!, job.payload as never);
      return;
    }
  }
}

async function runOne(job: ClaimedJob) {
  try {
    await handle(job);
    if (!(await completeJob(job))) log.warn("job.lease_lost", { kind: job.kind, jobId: job.id });
  } catch (e) {
    const final = await failJob(job, (e as Error).message ?? "error", (e as { retryable?: boolean }).retryable !== false);
    log.warn("job.failed", { kind: job.kind, attempt: job.attempts, final, err: (e as Error).message });
  }
}

let draining: Promise<number> | null = null;

/**
 * Procesa los trabajos vencidos con concurrencia acotada (global y por empresa) hasta vaciar la cola
 * o llegar a `max`; devuelve cuántos procesó. Una sola pasada por proceso a la vez.
 */
export function drainOnce(max = 200): Promise<number> {
  if (draining) return Promise.resolve(0);
  draining = pool(max).finally(() => {
    draining = null;
  });
  return draining;
}

async function pool(max: number): Promise<number> {
  const concurrency = workerConcurrency();
  const active = new Map<string, Promise<void>>();
  let processed = 0;
  const heartbeat = setInterval(() => {
    if (active.size) void renewLeases(WORKER_ID, [...active.keys()], leaseSeconds()).catch((e) => log.warn("job.renew_failed", { err: e }));
  }, Math.max(1000, (leaseSeconds() * 1000) / 3));
  try {
    for (;;) {
      const free = Math.min(concurrency - active.size, max - processed - active.size);
      const batch = free > 0 ? await claimJobs(WORKER_ID, free, { lockSeconds: leaseSeconds(), perTenant: tenantConcurrency() }) : [];
      for (const job of batch) {
        const p = runOne(job).finally(() => {
          active.delete(job.id);
          processed++;
        });
        active.set(job.id, p);
      }
      if (active.size === 0) break;
      // mientras hay trabajos en curso se sigue mirando la cola: un mensaje nuevo (p. ej. "quiero un
      // asesor") no espera a que termine una llamada lenta a la IA
      await Promise.race([...active.values(), new Promise((r) => setTimeout(r, POLL_MS))]);
    }
  } finally {
    clearInterval(heartbeat);
  }
  return processed;
}
