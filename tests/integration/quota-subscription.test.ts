import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { subscriptions, usageCounters } from "@/server/db/schema";
import { changeSubscription } from "@/server/services/plans";
import { createContact, listContacts } from "@/server/services/contacts";
import { connectWhatsapp } from "@/server/services/channels";
import { currentPeriod, getPlanState, getUsageSummary, recordUsage, reserveAiCall } from "@/server/services/usage";
import { provisionChatwootAccount } from "@/server/services/chatwoot-provisioning";
import { createOpportunity } from "@/server/services/opportunities";
import { makePlatformAdmin, twoTenants } from "../helpers/factory";

describe("cuotas y suscripciones", () => {
  it("reserva de IA es idempotente y atómica bajo concurrencia", async () => {
    const { A } = await twoTenants();
    await db.update(subscriptions).set({ limitOverrides: { aiCallsPerMonth: 5 } }).where(eq(subscriptions.tenantId, A.id));
    const r1 = await reserveAiCall(A.id, "k-1", { provider: "x", model: "m" });
    const r1b = await reserveAiCall(A.id, "k-1", { provider: "x", model: "m" });
    expect(r1.ok && r1b.ok && r1b.duplicate).toBe(true);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveAiCall(A.id, `c-${i}`, { provider: "x", model: "m" })));
    expect(results.filter((r) => r.ok)).toHaveLength(4); // 5 de cupo - 1 ya usado
    const counter = await db.query.usageCounters.findFirst({ where: and(eq(usageCounters.tenantId, A.id), eq(usageCounters.period, currentPeriod()), eq(usageCounters.metric, "ai_calls")) });
    expect(counter?.value).toBe(5);
  });

  it("dos requests concurrentes en el límite no superan la cuota de números", async () => {
    const { A, ctxA } = await twoTenants();
    await provisionChatwootAccount(A.id, null);
    await db.update(subscriptions).set({ limitOverrides: { whatsappNumbers: 1 } }).where(eq(subscriptions.tenantId, A.id));
    const base = String(Date.now()).slice(-7);
    const mk = (i: number) =>
      connectWhatsapp(ctxA, { displayName: `N${i}`, phoneNumber: `+5491160${base}${i}`.slice(0, 14), wabaId: `9${base}${i}`, phoneNumberId: `8${base}${i}`, accessToken: "EAAtoken-de-simulador-123456789", billingOwnerConfirmed: true });
    const res = await Promise.allSettled([mk(1), mk(2)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/máximo de números/);
  });

  it("cambio de plan altera límites inmediatamente y queda auditado; eventos duplicados no suman consumo", async () => {
    const admin = await makePlatformAdmin();
    const { A } = await twoTenants();
    expect((await getPlanState(A.id)).limits.aiCallsPerMonth).toBe(10000);
    await changeSubscription(admin.id, A.id, { planCode: "pro" });
    expect((await getPlanState(A.id)).limits.aiCallsPerMonth).toBe(50000);
    expect(await recordUsage(A.id, "messages_in", "msg:1")).toBe(true);
    expect(await recordUsage(A.id, "messages_in", "msg:1")).toBe(false);
    expect((await getUsageSummary(A.id)).usage.messagesIn).toBe(1);
  });

  it("suspensión: lectura permitida, escrituras/automatizaciones bloqueadas; A/B aislados", async () => {
    const admin = await makePlatformAdmin();
    const { A, ctxA, ctxB } = await twoTenants();
    const c = await createContact(ctxA, { name: "Histórico", phone: "+5491166667777" });
    await changeSubscription(admin.id, A.id, { status: "suspended" });
    expect((await listContacts(ctxA)).items.map((x) => x.id)).toContain(c.id);
    await expect(createOpportunity(ctxA, { contactId: c.id, title: "Nueva" })).rejects.toThrow(/suspendida/);
    await expect(reserveAiCall(A.id, "s-1", { provider: "x", model: "m" })).resolves.toMatchObject({ ok: false, reason: "inactive" });
    // B no se ve afectado
    const cb = await createContact(ctxB, { name: "B ok", phone: "+5491166668888" });
    await expect(createOpportunity(ctxB, { contactId: cb.id, title: "Sigue" })).resolves.toBeTruthy();
    await changeSubscription(admin.id, A.id, { status: "active" });
    await expect(createOpportunity(ctxA, { contactId: c.id, title: "Reactivada" })).resolves.toBeTruthy();
  });
});
