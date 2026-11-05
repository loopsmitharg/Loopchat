import "dotenv/config";
import { getPool } from "../src/server/db";
import { collect, evaluateAndNotify, notify } from "../src/server/ops/monitor";

/**
 * Monitor operativo. Uso:
 *   npm run monitor                 una pasada (cron/systemd cada minuto)
 *   npm run monitor -- --loop 60    servicio continuo (contenedor)
 *   npm run monitor -- --test       envía una alerta de prueba por los canales configurados
 * Sale con código 1 si hay alertas críticas activas (útil para orquestadores).
 */
async function once() {
  const { findings, metrics } = await collect();
  const r = await evaluateAndNotify(findings);
  console.log(JSON.stringify({ t: new Date().toISOString(), metrics, firing: findings.map((f) => f.key), notified: r }));
  return findings.some((f) => f.severity === "critical");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--test")) {
    const ch = await notify({ title: "[Loopchat prueba] Alerta de prueba", lines: ["Si ves este mensaje, las alertas del monitor llegan correctamente."] });
    console.log(`Alerta de prueba enviada por: ${ch.join(", ") || "ningún canal (configurá ALERT_WEBHOOK_URL o ALERT_EMAIL)"}`);
    if (!ch.length) process.exitCode = 1;
    return;
  }
  const loop = args.includes("--loop") ? Number(args[args.indexOf("--loop") + 1] || 60) : 0;
  if (!loop) {
    if (await once()) process.exitCode = 1;
    return;
  }
  for (;;) {
    try {
      await once();
    } catch (e) {
      console.error(JSON.stringify({ t: new Date().toISOString(), error: (e as Error).message }));
    }
    await new Promise((r) => setTimeout(r, loop * 1000));
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!process.argv.includes("--loop")) void getPool().end();
  });
