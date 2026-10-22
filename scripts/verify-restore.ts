import "dotenv/config";
import { Pool } from "pg";
import { decryptSecret } from "../src/server/crypto/vault";

/**
 * Verifica un restore: cuenta registros clave y comprueba que las credenciales cifradas
 * se puedan descifrar con LOOPCHAT_ENCRYPTION_KEYS (sin imprimir secretos).
 * Uso: RESTORE_DATABASE_URL=postgres://…/loopchat_restore npm run verify:restore
 */
async function main() {
  const url = process.env.RESTORE_DATABASE_URL;
  if (!url) throw new Error("RESTORE_DATABASE_URL requerido");
  const pool = new Pool({ connectionString: url, max: 1 });
  const counts = await pool.query(
    "select (select count(*) from tenants) t, (select count(*) from memberships) m, (select count(*) from conversations) c, (select count(*) from messages) msg, (select count(*) from opportunities) o, (select count(*) from bot_versions) bv",
  );
  console.log("Registros:", counts.rows[0]);
  let ok = 0;
  let fail = 0;
  const check = (enc: string, aad: string) => {
    try {
      decryptSecret(enc, aad);
      ok++;
    } catch {
      fail++;
    }
  };
  for (const r of (await pool.query("select tenant_id, api_key_enc from ai_provider_connections")).rows) check(r.api_key_enc, `ai:${r.tenant_id}`);
  for (const r of (await pool.query("select tenant_id, access_token_enc from channel_connections")).rows) check(r.access_token_enc, `meta:${r.tenant_id}`);
  for (const r of (await pool.query("select tenant_id, api_token_enc, webhook_secret_enc from chatwoot_accounts")).rows) {
    check(r.api_token_enc, `cw:${r.tenant_id}`);
    if (r.webhook_secret_enc) check(r.webhook_secret_enc, `cwwh:${r.tenant_id}`);
  }
  console.log(`Secretos descifrables: ${ok}, con error: ${fail}`);
  await pool.end();
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
