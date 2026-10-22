import "dotenv/config";
import { getPool } from "../src/server/db";
import { seedDemoCatalog } from "./lib/demo-catalog";

/** Agrega (si faltan) los datos DEMO del módulo de bots. Idempotente; solo desarrollo. */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Solo para desarrollo");
  // en una demo existente no se toca la configuración ni se publica el bot del usuario
  await seedDemoCatalog({ configureBot: false });
  console.log("Catálogo y datos comerciales DEMO listos (si faltaban).");
  await getPool().end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
