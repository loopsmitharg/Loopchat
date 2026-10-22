import { execSync, spawn, type ChildProcess } from "node:child_process";
import { resetDatabase } from "./reset-db";

const procs: ChildProcess[] = [];

async function waitFor(url: string, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No respondió ${url}`);
}

async function ensureSim(script: string, port: number, health: string) {
  try {
    const r = await fetch(`http://localhost:${port}${health}`);
    if (r.ok) return;
  } catch {}
  const p = spawn("npx", ["tsx", script], { stdio: "ignore", env: { ...process.env }, shell: process.platform === "win32" });
  procs.push(p);
  await waitFor(`http://localhost:${port}${health}`);
}

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://loopchat:loopchat@localhost:5432/loopchat_test";
  // Recrea el esquema de test desde las migraciones versionadas (reproducible).
  await resetDatabase(url);
  execSync(`npx tsx scripts/migrate.ts`, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  // Simuladores de contrato (Chatwoot / Meta Graph / IA) para pruebas sin credenciales externas.
  await ensureSim("tools/chatwoot-sim/server.ts", 3011, "/__sim/health");
  await ensureSim("tools/ai-sim/server.ts", 3012, "/__sim/requests");
  return async () => {
    for (const p of procs) p.kill();
  };
}
