import { execSync } from "node:child_process";
import { test as setup, expect } from "@playwright/test";
import { resetDatabase } from "../helpers/reset-db";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://loopchat:loopchat@localhost:5432/loopchat_e2e";

setup("base E2E reproducible: esquema, datos DEMO y simuladores", async ({ request }) => {
  setup.setTimeout(180_000);
  await resetDatabase(DB);
  const env = { ...process.env, DATABASE_URL: DB, CHATWOOT_BASE_URL: "http://localhost:3011", CHATWOOT_PLATFORM_TOKEN: "sim-platform-token", CHATWOOT_WEBHOOK_TARGET_URL: `http://localhost:${PORT}`, META_GRAPH_BASE_URL: "http://localhost:3011/meta-graph/v22.0", LOOPCHAT_ALLOW_PRIVATE_URLS: "true", LOOPCHAT_INLINE_WORKER: "false", NODE_ENV: "development" } as NodeJS.ProcessEnv;
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx --conditions=react-server scripts/seed-demo.ts", { env, stdio: "ignore" });
  await request.post("http://localhost:3011/__sim/reset");
  await request.get("http://localhost:3012/__sim/reset");
  execSync("npx tsx --conditions=react-server scripts/seed-demo-sim.ts", { env, stdio: "inherit" });
  // esperar a que los webhooks DEMO se procesen: el bot responde 4 conversaciones y en la 5.ª
  // (pide humano) envía el mensaje fijo de transferencia configurado en la demo
  await expect
    .poll(
      async () => {
        const s = await (await request.get("http://localhost:3011/__sim/state")).json();
        return s.accounts.flatMap((a: { conversations: { messages: { message_type: number }[] }[] }) => a.conversations).filter((c: { messages: { message_type: number }[] }) => c.messages.some((m) => m.message_type === 1)).length;
      },
      { timeout: 60_000 },
    )
    .toBe(5);
});
