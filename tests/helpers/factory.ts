import { eq } from "drizzle-orm";
import type { Role } from "@/lib/permissions";
import { db } from "@/server/db";
import { memberships, platformAdmins, tenants, user as userTable } from "@/server/db/schema";
import { createPasswordUser } from "@/server/auth";
import type { Ctx } from "@/server/authz/context";
import { ensureDefaultPlans } from "@/server/services/plans";
import { createTenant } from "@/server/services/tenants";

let seq = 0;
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function makeUser(name = "Usuario Test") {
  const email = `u-${uid()}@test.local`;
  const u = await createPasswordUser({ email, name, password: "contraseña-segura-1" });
  return { id: u.id, email, name, password: "contraseña-segura-1" };
}

export async function makePlatformAdmin() {
  const u = await makeUser("Admin Loop Smiths");
  await db.insert(platformAdmins).values({ userId: u.id });
  return u;
}

export async function makeTenant(planCode = "growth", name = "Empresa Test") {
  await ensureDefaultPlans();
  const slug = `t-${uid()}`;
  const { tenant } = await createTenant({ name, slug, planCode, adminEmail: `admin-${uid()}@test.local`, subscriptionStatus: "active" }, null);
  return tenant;
}

export async function addMember(tenantId: string, role: Role, name?: string) {
  const u = await makeUser(name ?? `Miembro ${role}`);
  await db.insert(memberships).values({ tenantId, userId: u.id, role });
  return u;
}

export function ctxFor(tenantId: string, u: { id: string; name: string }, role: Role): Ctx {
  return { tenantId, actor: { kind: "user", userId: u.id, role, name: u.name } };
}

/** Escenario estándar: dos empresas A/B, cada una con admin y agente. */
export async function twoTenants() {
  const A = await makeTenant("growth", "Empresa A");
  const B = await makeTenant("growth", "Empresa B");
  const adminA = await addMember(A.id, "tenant_admin", "Ana Admin");
  const agentA = await addMember(A.id, "agent", "Andrés Agente");
  const adminB = await addMember(B.id, "tenant_admin", "Bruno Admin");
  return {
    A,
    B,
    adminA,
    agentA,
    adminB,
    ctxA: ctxFor(A.id, adminA, "tenant_admin"),
    ctxAgentA: ctxFor(A.id, agentA, "agent"),
    ctxB: ctxFor(B.id, adminB, "tenant_admin"),
  };
}

export async function tenantById(id: string) {
  return db.query.tenants.findFirst({ where: eq(tenants.id, id) });
}
export async function userById(id: string) {
  return db.query.user.findFirst({ where: eq(userTable.id, id) });
}
