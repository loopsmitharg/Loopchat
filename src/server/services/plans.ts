import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_PLANS } from "@/lib/plans";
import { db } from "../db";
import { plans, subscriptions, tenants, SUBSCRIPTION_STATUSES } from "../db/schema";
import { notFound } from "../http/errors";
import { audit } from "./audit";

export async function ensureDefaultPlans() {
  for (const p of DEFAULT_PLANS) {
    await db.insert(plans).values(p).onConflictDoNothing({ target: plans.code });
  }
}

export async function listPlans() {
  return db.select().from(plans).orderBy(asc(plans.createdAt));
}

const limitsSchema = z.object({
  whatsappNumbers: z.number().int().min(0).max(1000),
  agents: z.number().int().min(1).max(10000),
  pipelines: z.number().int().min(1).max(1000).nullable(),
  activeBots: z.number().int().min(0).max(1000),
  aiCallsPerMonth: z.number().int().min(0).max(100_000_000),
  editor: z.enum(["basic", "full"]),
});

export const updatePlanSchema = z.object({ name: z.string().trim().min(2).max(60).optional(), limits: limitsSchema.optional(), isActive: z.boolean().optional() });

export async function updatePlan(actorUserId: string, planId: string, input: z.input<typeof updatePlanSchema>) {
  const data = updatePlanSchema.parse(input);
  const res = await db.update(plans).set({ ...data, updatedAt: new Date() }).where(eq(plans.id, planId)).returning();
  if (res.length === 0) throw notFound();
  await audit({ tenantId: null, actorUserId, actorKind: "platform", action: "plan.updated", targetType: "plan", targetId: planId, data });
  return res[0];
}

export const changeSubscriptionSchema = z.object({
  planCode: z.string().optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  notes: z.string().max(500).optional(),
});

/** Cambio de plan/estado por Loop Smiths. Efecto inmediato en límites; auditado. */
export async function changeSubscription(actorUserId: string, tenantId: string, input: z.input<typeof changeSubscriptionSchema>) {
  const data = changeSubscriptionSchema.parse(input);
  return db.transaction(async (tx) => {
    const sub = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, tenantId) });
    if (!sub) throw notFound();
    const patch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date(), updatedBy: actorUserId };
    if (data.planCode) {
      const plan = await tx.query.plans.findFirst({ where: eq(plans.code, data.planCode) });
      if (!plan) throw notFound("Plan inexistente.");
      patch.planId = plan.id;
    }
    if (data.status) patch.status = data.status;
    if (data.notes !== undefined) patch.notes = data.notes;
    await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));
    if (data.status) {
      await tx
        .update(tenants)
        .set({ status: data.status === "suspended" || data.status === "cancelled" ? "suspended" : "active", updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
    }
    await audit({ tenantId, actorUserId, actorKind: "platform", action: "subscription.changed", targetType: "subscription", targetId: sub.id, data: { from: { planId: sub.planId, status: sub.status }, to: data } }, tx);
  });
}
