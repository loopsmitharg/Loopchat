import "dotenv/config";
import { isNotNull } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db";
import { chatwootAccounts } from "../src/server/db/schema";
import { enqueue } from "../src/server/jobs/queue";
import { drainOnce } from "../src/server/jobs/worker";
import { log } from "../src/server/log";
import { purgeOldWebhookPayloads } from "../src/server/services/ops";

/**
 * Worker de Loopchat: procesa la cola (eventos Chatwoot, ejecuciones de bots, esperas) y
 * agenda tareas periódicas (reconciliación de conversaciones, retención de datos).
 * Uso: npm run worker  (en producción, como servicio separado del web).
 */
let stopping = false;
const RECONCILE_EVERY_MS = 15 * 60_000;
const PURGE_EVERY_MS = 24 * 3600_000;

async function scheduleReconcile() {
  const rows = await getDb().select({ tenantId: chatwootAccounts.tenantId }).from(chatwootAccounts).where(isNotNull(chatwootAccounts.webhookId));
  for (const r of rows) await enqueue("chatwoot.reconcile_account", {}, { tenantId: r.tenantId, dedupKey: `reconcile:${r.tenantId}:${Math.floor(Date.now() / RECONCILE_EVERY_MS)}`, maxAttempts: 2 });
}

async function main() {
  process.env.LOOPCHAT_INLINE_WORKER = "false";
  log.info("worker.started");
  let lastReconcile = 0;
  let lastPurge = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastReconcile > RECONCILE_EVERY_MS) {
        await scheduleReconcile();
        lastReconcile = Date.now();
      }
      if (Date.now() - lastPurge > PURGE_EVERY_MS) {
        await purgeOldWebhookPayloads(30);
        lastPurge = Date.now();
      }
      const n = await drainOnce(100);
      if (n === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      log.error("worker.loop_error", { err: e });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await getPool().end();
  log.info("worker.stopped");
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stopping = true));
void main();
