import "dotenv/config";
import { eq } from "drizzle-orm";
import { createPasswordUser } from "../src/server/auth";
import { getDb, getPool } from "../src/server/db";
import { memberships, platformAdmins, tenants, user } from "../src/server/db/schema";
import { ensureDefaultPlans } from "../src/server/services/plans";
import { createTenant } from "../src/server/services/tenants";

/**
 * Datos DEMO para desarrollo local (rotulados "DEMO"; nunca en producción).
 * Contraseña común de los usuarios demo: DEMO_PASSWORD o "demo-loopchat-123".
 */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed-demo no se ejecuta en producción");
  const password = process.env.DEMO_PASSWORD ?? "demo-loopchat-123";
  const db = getDb();
  await ensureDefaultPlans();

  async function ensureUser(email: string, name: string) {
    const found = await db.query.user.findFirst({ where: eq(user.email, email) });
    if (found) return found.id;
    return (await createPasswordUser({ email, name, password })).id;
  }
  async function ensureTenant(slug: string, name: string, plan: string) {
    const found = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
    if (found) return found.id;
    const { tenant } = await createTenant({ name, slug, planCode: plan, adminEmail: `invitacion-${slug}@demo.loopchat.test`, subscriptionStatus: "active" }, null);
    return tenant.id;
  }
  async function member(tenantId: string, userId: string, role: "tenant_admin" | "manager" | "agent" | "viewer") {
    await db.insert(memberships).values({ tenantId, userId, role }).onConflictDoNothing();
  }

  const platform = await ensureUser("plataforma@demo.loopchat.test", "Paula Plataforma (DEMO)");
  await db.insert(platformAdmins).values({ userId: platform }).onConflictDoNothing();

  const a = await ensureTenant("demo-ferreteria-norte", "DEMO Ferretería Norte", "growth");
  const b = await ensureTenant("demo-optica-sur", "DEMO Óptica Sur", "starter");

  await member(a, await ensureUser("admin@ferreteria.demo.loopchat.test", "Ana Ferreyra (DEMO)"), "tenant_admin");
  await member(a, await ensureUser("manager@ferreteria.demo.loopchat.test", "Martín Gómez (DEMO)"), "manager");
  await member(a, await ensureUser("agente@ferreteria.demo.loopchat.test", "Carla Ruiz (DEMO)"), "agent");
  await member(a, await ensureUser("agente2@ferreteria.demo.loopchat.test", "Diego Sosa (DEMO)"), "agent");
  await member(a, await ensureUser("lectura@ferreteria.demo.loopchat.test", "Victoria Paz (DEMO)"), "viewer");
  await member(b, await ensureUser("admin@optica.demo.loopchat.test", "Bruno Ibarra (DEMO)"), "tenant_admin");

  console.log("Datos DEMO listos. Usuarios (contraseña común):");
  console.log("  plataforma@demo.loopchat.test  → Panel Loop Smiths");
  console.log("  admin@ferreteria.demo.loopchat.test / manager@… / agente@… / agente2@… / lectura@…");
  console.log("  admin@optica.demo.loopchat.test (empresa B)");
  await getPool().end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
