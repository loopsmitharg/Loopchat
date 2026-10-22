import "dotenv/config";
import { Client } from "pg";

/**
 * SOLO demo local: verifica que la base DEMO y el simulador de Chatwoot estén sincronizados
 * (cada cuenta Chatwoot guardada en la base existe en el simulador).
 * Sale con 0 si están sincronizados y con 2 si hay que recrear la demo desde cero.
 */
const SIM = process.env.CHATWOOT_BASE_URL ?? "http://localhost:3011";

async function main() {
  let ids: number[] = [];
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    ids = (await c.query<{ id: number }>("select chatwoot_account_id as id from chatwoot_accounts")).rows.map((r) => r.id);
  } catch {
    ids = []; // base vacía o sin migrar
  } finally {
    await c.end();
  }
  const state = (await (await fetch(`${SIM}/__sim/state`)).json()) as { accounts: { id: number; inboxes: unknown[] }[] };
  const known = new Set(state.accounts.filter((a) => a.inboxes.length > 0).map((a) => a.id));
  const ok = ids.length > 0 && ids.every((id) => known.has(id));
  console.log(ok ? "Base y simulador sincronizados: se conservan los datos." : "Base y simulador no coinciden: se recrea la demo desde cero.");
  process.exit(ok ? 0 : 2);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
