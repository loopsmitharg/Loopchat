import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatwootAccounts } from "../db/schema";
import { decryptSecret } from "../crypto/vault";
import { policyBlocked } from "../http/errors";
import { ChatwootAccountClient, chatwootBaseUrl } from "./client";

/**
 * Cliente Chatwoot de un tenant. El account_id SIEMPRE sale del mapeo tenant↔cuenta
 * guardado en Loopchat, nunca de un parámetro del cliente.
 */
export async function getTenantChatwoot(tenantId: string) {
  const row = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, tenantId) });
  if (!row) throw policyBlocked("La empresa todavía no tiene el motor de mensajería configurado.", { reason: "chatwoot_not_provisioned" });
  const token = decryptSecret(row.apiTokenEnc, `cw:${tenantId}`);
  return { client: new ChatwootAccountClient(chatwootBaseUrl(), token, row.chatwootAccountId), mapping: row };
}
