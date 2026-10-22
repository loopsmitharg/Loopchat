import "server-only";
import { and, eq } from "drizzle-orm";
import { can, type Permission, type Role } from "@/lib/permissions";
import { getAuth } from "../auth";
import { db } from "../db";
import { memberships, platformAdmins, tenants } from "../db/schema";
import { forbidden, unauthorized } from "../http/errors";

export type Actor =
  | { kind: "user"; userId: string; role: Role; name: string }
  | { kind: "bot"; botId: string; runId?: string }
  | { kind: "system" };

export type Ctx = { tenantId: string; actor: Actor; ip?: string | null };

export type SessionUser = { id: string; name: string; email: string };

export const TENANT_COOKIE = "loopchat_tenant";

/** Permisos que un bot puede ejercer (allowlist de herramientas). */
const BOT_PERMISSIONS = new Set<Permission>([
  "conversation:read",
  "conversation:reply",
  "conversation:bot_control",
  "contact:read",
  "contact:write",
  "opportunity:read",
  "opportunity:write",
  "task:write",
  "knowledge:read",
  "catalog:read",
]);

export function hasPermission(ctx: Ctx, permission: Permission): boolean {
  switch (ctx.actor.kind) {
    case "user":
      return can(ctx.actor.role, permission);
    case "bot":
      return BOT_PERMISSIONS.has(permission);
    case "system":
      return true;
  }
}

export function assertCan(ctx: Ctx, permission: Permission) {
  if (!hasPermission(ctx, permission)) throw forbidden();
}

export function actorUserId(ctx: Ctx): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

export function actorKind(ctx: Ctx): "user" | "bot" | "system" {
  return ctx.actor.kind;
}

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const res = await getAuth().api.getSession({ headers });
  if (!res?.user) return null;
  return { id: res.user.id, name: res.user.name, email: res.user.email };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const row = await db.query.platformAdmins.findFirst({ where: eq(platformAdmins.userId, userId) });
  return Boolean(row);
}

export type MembershipSummary = { tenantId: string; tenantName: string; tenantSlug: string; tenantStatus: string; role: Role };

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantStatus: tenants.status,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
    .orderBy(tenants.name);
  return rows;
}

/**
 * Resuelve la empresa activa. La preferencia (cookie) se valida SIEMPRE contra
 * las membresías activas del usuario: nunca se confía en un tenant enviado por el cliente.
 */
export async function resolveTenantCtx(user: SessionUser, preferredTenantId?: string | null, ip?: string | null) {
  const list = await listMemberships(user.id);
  if (list.length === 0) return null;
  const chosen = list.find((m) => m.tenantId === preferredTenantId) ?? list[0];
  const ctx: Ctx = { tenantId: chosen.tenantId, actor: { kind: "user", userId: user.id, role: chosen.role, name: user.name }, ip };
  return { ctx, membership: chosen, memberships: list };
}

export async function requireUser(headers: Headers): Promise<SessionUser> {
  const u = await getSessionUser(headers);
  if (!u) throw unauthorized();
  return u;
}
