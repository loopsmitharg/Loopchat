import "server-only";
import { log } from "../log";
import { claimJobs, completeJob, failJob, type ClaimedJob } from "./queue";

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
      await executeRunJob(job.payload as never, job.attempts, job.maxAttempts);
      return;
    }
    case "team.automation": {
      const { runTeamAutomations } = await import("../teams/automations");
      await runTeamAutomations(job.tenantId!, job.payload as never);
      return;
    }
  }
}

let draining = false;

/** Procesa todos los trabajos vencidos y devuelve cuántos procesó. */
export async function drainOnce(max = 50): Promise<number> {
  if (draining) return 0;
  draining = true;
  let processed = 0;
  try {
    while (processed < max) {
      const batch = await claimJobs(10);
      if (batch.length === 0) break;
      for (const job of batch) {
        try {
          await handle(job);
          await completeJob(job.id);
        } catch (e) {
          const final = await failJob(job, (e as Error).message ?? "error", (e as { retryable?: boolean }).retryable !== false);
          log.warn("job.failed", { kind: job.kind, attempt: job.attempts, final, err: (e as Error).message });
        }
        processed++;
      }
    }
  } finally {
    draining = false;
  }
  return processed;
}
