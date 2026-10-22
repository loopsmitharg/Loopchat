import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_STAGE_TEMPLATE } from "@/lib/pipeline-template";
import { db, type Tx } from "../db";
import { chatwootAccounts, channelConnections, memberships, pipelines, plans, stages, subscriptions, tenants, SUBSCRIPTION_STATUSES } from "../db/schema";
import { badRequest, conflict, notFound } from "../http/errors";
import { audit } from "./audit";
import { createInvitation } from "./invitations";
import { getUsageSummary } from "./usage";

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Usá minúsculas, números y guiones (3-48)."),
  planCode: z.string().min(1),
  adminEmail: z.string().trim().toLowerCase().email(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).default("trial"),
});

export async function createDefaultPipeline(tx: Tx, tenantId: string) {
  const [p] = await tx.insert(pipelines).values({ tenantId, name: "Ventas", position: 0, isDefault: true }).returning();
  await tx.insert(stages).values(DEFAULT_STAGE_TEMPLATE.map((s, i) => ({ tenantId, pipelineId: p.id, name: s.name, kind: s.kind, position: i })));
  return p;
}

export async function createTenant(input: z.input<typeof createTenantSchema>, actorUserId: string | null) {
  const data = createTenantSchema.parse(input);
  const plan = await db.query.plans.findFirst({ where: and(eq(plans.code, data.planCode), eq(plans.isActive, true)) });
  if (!plan) throw badRequest("Plan inexistente o inactivo.");
  const existing = await db.query.tenants.findFirst({ where: eq(tenants.slug, data.slug) });
  if (existing) throw conflict("Ya existe una empresa con ese identificador.");
  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: data.name, slug: data.slug, settings: { autoCreateOpportunity: true } }).returning();
    await tx.insert(subscriptions).values({
      tenantId: tenant.id,
      planId: plan.id,
      status: data.subscriptionStatus,
      updatedBy: actorUserId,
      trialEndsAt: data.subscriptionStatus === "trial" ? new Date(Date.now() + 30 * 86400_000) : null,
    });
    await createDefaultPipeline(tx, tenant.id);
    await audit({ tenantId: tenant.id, actorUserId, actorKind: "platform", action: "tenant.created", targetType: "tenant", targetId: tenant.id, data: { plan: plan.code } }, tx);
    return tenant;
  });
  const invitation = await createInvitation(
    { tenantId: result.id, actor: actorUserId ? { kind: "platform", userId: actorUserId } : { kind: "system" } },
    { email: data.adminEmail, role: "tenant_admin" },
  );
  return { tenant: result, invitation };
}

export async function listTenantsForPlatform() {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      createdAt: tenants.createdAt,
      planCode: plans.code,
      planName: plans.name,
      subscriptionStatus: subscriptions.status,
      members: sql<number>`(select count(*)::int from ${memberships} m where m.tenant_id = "tenants"."id" and m.status = 'active')`,
      numbers: sql<number>`(select count(*)::int from ${channelConnections} c where c.tenant_id = "tenants"."id" and c.status <> 'disconnected')`,
      chatwootAccountId: chatwootAccounts.chatwootAccountId,
    })
    .from(tenants)
    .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .leftJoin(chatwootAccounts, eq(chatwootAccounts.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt));
  return rows;
}

export async function getTenantForPlatform(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw notFound();
  const usage = await getUsageSummary(tenantId);
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, tenantId) });
  const cw = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, tenantId) });
  const channels = await db
    .select({ id: channelConnections.id, displayName: channelConnections.displayName, phoneNumber: channelConnections.phoneNumber, status: channelConnections.status, lastError: channelConnections.lastError, lastVerifiedAt: channelConnections.lastVerifiedAt })
    .from(channelConnections)
    .where(eq(channelConnections.tenantId, tenantId))
    .orderBy(asc(channelConnections.createdAt));
  return {
    tenant,
    subscription: sub,
    usage,
    chatwoot: cw ? { accountId: cw.chatwootAccountId, status: cw.status, lastError: cw.lastError, provisionedBy: cw.provisionedBy, webhookConfigured: Boolean(cw.webhookId) } : null,
    channels,
  };
}
