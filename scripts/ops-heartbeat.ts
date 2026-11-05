import "dotenv/config";
import { getPool } from "../src/server/db";
import { recordHeartbeat } from "../src/server/ops/monitor";

/** Registra el resultado de una tarea operativa. Uso: npm run ops:heartbeat -- backup ok "detalle" */
const [name, status, ...detail] = process.argv.slice(2);
if (!name || (status !== "ok" && status !== "fail")) {
  console.error("Uso: ops-heartbeat <nombre> <ok|fail> [detalle]");
  process.exit(2);
}
recordHeartbeat(name, status, detail.join(" ").slice(0, 500) || null)
  .then(() => console.log(`heartbeat ${name}=${status}`))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => void getPool().end());
