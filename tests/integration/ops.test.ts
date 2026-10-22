import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { webhookEvents } from "@/server/db/schema";
import { checkHealth, platformOverview, purgeOldWebhookPayloads, reprocessFailedEvents } from "@/server/services/ops";
import { getDashboardMetrics } from "@/server/services/metrics";
import { makePlatformAdmin, twoTenants } from "../helpers/factory";

describe("operación (SQL crudo de salud, panel y retención)", () => {
  it("health, panorama de plataforma, reproceso y purga", async () => {
    const admin = await makePlatformAdmin();
    const { A, ctxA } = await twoTenants();
    const old = new Date(Date.now() - 40 * 86400_000);
    await db.insert(webhookEvents).values([
      { tenantId: A.id, dedupKey: `ops-1-${Date.now()}`, event: "message_created", status: "failed", payload: { x: 1 } },
      { tenantId: A.id, dedupKey: `ops-2-${Date.now()}`, event: "message_created", status: "processed", payload: { x: 2 }, receivedAt: old },
    ]);
    const h = await checkHealth();
    expect(h.database).toBe("ok");
    expect(h.queue).toHaveProperty("queued");
    const ov = await platformOverview();
    expect(ov.find((r) => r.tenant_id === A.id)?.failed_events).toBe(1);
    expect(ov.find((r) => r.tenant_id === A.id)?.last_event_at).toBeTruthy();
    const m = await getDashboardMetrics(ctxA, { from: new Date(Date.now() - 86400_000), to: new Date() });
    expect(m.pending?.failed_events).toBe(1);
    const re = await reprocessFailedEvents(A.id, admin.id);
    expect(re.requeued).toBe(1);
    const p = await purgeOldWebhookPayloads(30);
    expect(p.purged).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.tenantId, A.id));
    expect(rows.find((r) => r.status === "processed")?.payload).toBeNull();
  });
});

import { rateLimit } from "@/server/http/rate-limit";

describe("rate limit persistido", () => {
  it("permite hasta el máximo y luego responde 429", async () => {
    const prev = process.env.DISABLE_RATE_LIMIT;
    process.env.DISABLE_RATE_LIMIT = "false";
    try {
      const key = `rl-test-${Date.now()}`;
      for (let i = 0; i < 3; i++) await rateLimit(key, 3, 60);
      await expect(rateLimit(key, 3, 60)).rejects.toThrow(/Demasiados intentos/);
    } finally {
      process.env.DISABLE_RATE_LIMIT = prev;
    }
  });
});
