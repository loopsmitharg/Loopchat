import "dotenv/config";
import { eq } from "drizzle-orm";
import { createPasswordUser } from "../src/server/auth";
import { getDb, getPool } from "../src/server/db";
import { platformAdmins, user } from "../src/server/db/schema";
import { ensureDefaultPlans } from "../src/server/services/plans";

/** Crea (una vez) el primer administrador de Loop Smiths. Uso: npm run bootstrap:admin */
async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? "Admin Loop Smiths";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Definí BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD (mín. 10 caracteres).");
  await ensureDefaultPlans();
  const db = getDb();
  let u = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!u) {
    const created = await createPasswordUser({ email, name, password });
    u = { ...created, image: created.image ?? null } as NonNullable<typeof u>;
    console.log(`Usuario ${email} creado.`);
  }
  await db.insert(platformAdmins).values({ userId: u!.id }).onConflictDoNothing();
  console.log(`${email} es administrador de plataforma. Quitá BOOTSTRAP_ADMIN_PASSWORD del .env.`);
  await getPool().end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
