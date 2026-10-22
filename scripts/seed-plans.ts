import "dotenv/config";
import { ensureDefaultPlans } from "../src/server/services/plans";
import { getPool } from "../src/server/db";

ensureDefaultPlans()
  .then(async () => {
    console.log("Planes por defecto asegurados (Starter/Growth/Pro).");
    await getPool().end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
