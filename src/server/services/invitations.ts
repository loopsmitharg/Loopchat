import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { invitations, memberships, tenants, user as userTable, ROLES } from "../db/schema";
import { randomToken, sha256 } from "../crypto/vault";
import { createPasswordUser } from "../auth";
import { assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, forbidden, notFound } from "../http/errors";
import { sendMail } from "../mail";
import { audit } from "./audit";
import { assertResourceQuota } from "./usage";

type InviteActor = { kind: "platform"; userId: string } | { kind: "system" } | { kind: "tenant"; ctx: Ctx };

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
});

const INVITE_TTL_MS = 7 * 86400_000;

export async function createInvitation(
  scope: { tenantId: string; actor: InviteActor | { kind: "platform"; userId: string } | { kind: "system" } },
  input: z.input<typeof inviteSchema>,
) {
  const data = inviteSchema.parse(input);
  const actor = scope.actor as InviteActor;
  let invitedBy: string | null = null;
  if (actor.kind === "tenant") {
    assertCan(actor.ctx, "members:manage");
    if (actor.ctx.tenantId !== scope.tenantId) throw notFound();
    invitedBy = actor.ctx.actor.kind === "user" ? actor.ctx.actor.userId : null;
  } else if (actor.kind === "platform") {
    invitedBy = actor.userId;
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, scope.tenantId) });
  if (!tenant) throw notFound();

  const existingUser = await db.query.user.findFirst({ where: eq(userTable.email, data.email) });
  if (existingUser) {
    const m = await db.query.memberships.findFirst({
      where: and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, existingUser.id), eq(memberships.status, "active")),
    });
    if (m) throw conflict("Esa persona ya es miembro de la empresa.");
  }
  await db.transaction(async (tx) => {
    await assertResourceQuota(tx, scope.tenantId, "agents", 1);
  });

  const token = randomToken(32);
  const [inv] = await db
    .insert(invitations)
    .values({
      tenantId: scope.tenantId,
      email: data.email,
      role: data.role,
      tokenHash: sha256(token),
      invitedBy,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/invitacion/${token}`;
  await sendMail({
    to: data.email,
    subject: `Te invitaron a ${tenant.name} en Loopchat`,
    text: `Hola,\n\nTe invitaron a sumarte a ${tenant.name} en Loopchat.\nAceptá la invitación (vence en 7 días):\n${url}\n\nLoopchat by Loop Smiths`,
  });
  await audit({
    tenantId: scope.tenantId,
    actorUserId: invitedBy,
    actorKind: actor.kind === "platform" ? "platform" : actor.kind === "system" ? "system" : "user",
    action: "invitation.created",
    targetType: "invitation",
    targetId: inv.id,
    data: { email: data.email, role: data.role },
  });
  return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, url };
}

async function findValidInvitation(token: string) {
  if (!token || token.length < 20 || token.length > 100) throw notFound("Invitación inválida o vencida.");
  const inv = await db.query.invitations.findFirst({
    where: and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())),
  });
  if (!inv) throw notFound("Invitación inválida o vencida.");
  return inv;
}

export async function describeInvitation(token: string) {
  const inv = await findValidInvitation(token);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, inv.tenantId) });
  const existingUser = await db.query.user.findFirst({ where: eq(userTable.email, inv.email) });
  return { email: inv.email, role: inv.role, tenantName: tenant?.name ?? "", userExists: Boolean(existingUser) };
}

export const acceptSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(2).max(80).optional(),
  password: z.string().min(10).max(128).optional(),
});

export async function acceptInvitation(input: z.input<typeof acceptSchema>, sessionUser: { id: string; email: string } | null) {
  const data = acceptSchema.parse(input);
  const inv = await findValidInvitation(data.token);
  let userId: string;
  const existingUser = await db.query.user.findFirst({ where: eq(userTable.email, inv.email) });
  if (existingUser) {
    if (!sessionUser || sessionUser.id !== existingUser.id) {
      throw forbidden("Ya existe una cuenta con ese email: iniciá sesión con ella y volvé a abrir el enlace.");
    }
    userId = existingUser.id;
  } else {
    if (!data.name || !data.password) throw badRequest("Completá tu nombre y una contraseña de al menos 10 caracteres.");
    const created = await createPasswordUser({ email: inv.email, name: data.name, password: data.password });
    userId = created.id;
  }
  await db.transaction(async (tx) => {
    // re-chequeo atómico: la invitación no fue usada en paralelo
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });
    if (claimed.length === 0) throw conflict("La invitación ya fue utilizada.");
    const existing = await tx.query.memberships.findFirst({ where: and(eq(memberships.tenantId, inv.tenantId), eq(memberships.userId, userId)) });
    if (existing) {
      await tx.update(memberships).set({ role: inv.role, status: "active", updatedAt: new Date() }).where(eq(memberships.id, existing.id));
    } else {
      await assertResourceQuota(tx, inv.tenantId, "agents", 1);
      await tx.insert(memberships).values({ tenantId: inv.tenantId, userId, role: inv.role });
    }
    await audit({ tenantId: inv.tenantId, actorUserId: userId, action: "invitation.accepted", targetType: "invitation", targetId: inv.id, data: { role: inv.role } }, tx);
  });
  return { tenantId: inv.tenantId, email: inv.email, createdUser: !existingUser };
}

export async function revokeInvitation(ctx: Ctx, invitationId: string) {
  assertCan(ctx, "members:manage");
  const res = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, ctx.tenantId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  if (res.length === 0) throw notFound();
  await audit({ tenantId: ctx.tenantId, actorUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null, action: "invitation.revoked", targetType: "invitation", targetId: invitationId });
}

export async function listPendingInvitations(ctx: Ctx) {
  assertCan(ctx, "members:manage");
  return db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(eq(invitations.tenantId, ctx.tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
}
