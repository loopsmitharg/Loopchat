import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLogs, tenants, user as userTable } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { notFound } from "../http/errors";
import { audit } from "./audit";

export async function getTenantSettings(ctx: Ctx) {
  assertCan(ctx, "dashboard:read");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  if (!t) throw notFound();
  return { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, defaultCurrency: t.defaultCurrency, settings: t.settings, status: t.status };
}

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(3).max(60).refine((tz) => {
    try {
      new Intl.DateTimeFormat("es-AR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona horaria inválida.").optional(),
  defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
  autoCreateOpportunity: z.boolean().optional(),
  businessHours: z
    .object({
      enabled: z.boolean(),
      days: z.array(z.number().int().min(0).max(6)).max(7),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .refine((h) => !h.enabled || h.start < h.end, "La hora de cierre debe ser posterior a la de apertura.")
    .optional(),
});

export async function updateTenantSettings(ctx: Ctx, input: z.input<typeof tenantSettingsSchema>) {
  assertCan(ctx, "settings:write");
  const d = tenantSettingsSchema.parse(input);
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  if (!t) throw notFound();
  await db
    .update(tenants)
    .set({
      name: d.name ?? t.name,
      timezone: d.timezone ?? t.timezone,
      defaultCurrency: d.defaultCurrency ?? t.defaultCurrency,
      settings: {
        ...t.settings,
        ...(d.autoCreateOpportunity !== undefined ? { autoCreateOpportunity: d.autoCreateOpportunity } : {}),
        ...(d.businessHours ? { businessHours: d.businessHours } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, t.id));
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "tenant.settings_updated", data: d });
  return getTenantSettings(ctx);
}

export async function listAudit(ctx: Ctx) {
  assertCan(ctx, "audit:read");
  return db
    .select({ id: auditLogs.id, action: auditLogs.action, actorKind: auditLogs.actorKind, actorName: userTable.name, targetType: auditLogs.targetType, createdAt: auditLogs.createdAt, data: auditLogs.data })
    .from(auditLogs)
    .leftJoin(userTable, eq(userTable.id, auditLogs.actorUserId))
    .where(eq(auditLogs.tenantId, ctx.tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);
}
