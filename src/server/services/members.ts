import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { memberships, user as userTable, ROLES } from "../db/schema";
import { revokeAllSessions } from "../auth";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { audit } from "./audit";

export async function listMembers(ctx: Ctx) {
  assertCan(ctx, "conversation:read");
  return db
    .select({ membershipId: memberships.id, userId: userTable.id, name: userTable.name, email: userTable.email, role: memberships.role, status: memberships.status })
    .from(memberships)
    .innerJoin(userTable, eq(userTable.id, memberships.userId))
    .where(eq(memberships.tenantId, ctx.tenantId))
    .orderBy(asc(userTable.name));
}

/** true si userId es miembro activo del tenant del contexto. */
export async function isActiveMember(tenantId: string, userId: string) {
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")),
  });
  return m ?? null;
}

export const updateMemberSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function updateMember(ctx: Ctx, membershipId: string, input: z.input<typeof updateMemberSchema>) {
  assertCan(ctx, "members:manage");
  const data = updateMemberSchema.parse(input);
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)) });
  if (!m) throw notFound();
  if (m.userId === actorUserId(ctx) && (data.status === "disabled" || (data.role && data.role !== "tenant_admin"))) {
    throw badRequest("No podés quitarte tu propio acceso de administrador.");
  }
  if (m.role === "tenant_admin" && (data.status === "disabled" || (data.role && data.role !== "tenant_admin"))) {
    const others = await db.query.memberships.findMany({
      where: and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.role, "tenant_admin"), eq(memberships.status, "active"), ne(memberships.id, m.id)),
    });
    if (others.length === 0) throw badRequest("La empresa debe conservar al menos un administrador activo.");
  }
  await db.update(memberships).set({ ...data, updatedAt: new Date() }).where(eq(memberships.id, m.id));
  if (data.status === "disabled") await revokeAllSessions(m.userId);
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "member.updated", targetType: "membership", targetId: m.id, data });
}
