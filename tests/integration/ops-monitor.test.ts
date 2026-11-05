import { createServer, type Server } from "node:http";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { collect, evaluateAndNotify, recordHeartbeat } from "@/server/ops/monitor";

let server: Server;
const received: string[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    received.push(JSON.parse(b).text);
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(3016, r));
  process.env.ALERT_WEBHOOK_URL = "http://localhost:3016";
});
afterAll(() => server.close());

describe("monitor operativo (P1-11)", () => {
  it("alerta: se notifica al abrirse, no se repite y avisa al resolverse", async () => {
    await db.execute(sql`delete from ops_alerts`);
    const f = [{ key: "test_alert", severity: "critical" as const, summary: "Algo falló" }];
    expect((await evaluateAndNotify(f, "host-test")).fired).toEqual(["test_alert"]);
    expect((await evaluateAndNotify(f, "host-test")).fired).toEqual([]);
    expect((await evaluateAndNotify([], "host-test")).resolved).toEqual(["test_alert"]);
    expect(received.some((t) => t.includes("CRÍTICO") && t.includes("Algo falló"))).toBe(true);
    expect(received.some((t) => t.includes("resuelto") && t.includes("Algo falló"))).toBe(true);
  });

  it("detecta backup fallido o ausente, cola atrasada y servicios caídos", async () => {
    process.env.MONITOR_APP_URL = "http://localhost:3999";
    await recordHeartbeat("backup", "fail", "pg_dump no disponible");
    await db.execute(sql`delete from ops_heartbeats where name = 'restore_test'`);
    await db.execute(sql`insert into jobs (kind, payload, status, run_at, dedup_key) values ('team.automation', '{}'::jsonb, 'queued', now() - interval '20 minutes', ${`monitor-test-${Date.now()}`})`);
    const { findings } = await collect();
    const keys = findings.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["app_down", "backup_failed", "restore_test_missing", "queue_lag"]));
    await db.execute(sql`delete from jobs where dedup_key like 'monitor-test-%'`);
    await recordHeartbeat("backup", "ok", "ok");
    delete process.env.MONITOR_APP_URL;
  });
});
