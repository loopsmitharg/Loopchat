import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatwootAccounts, webhookEvents } from "../db/schema";
import { decryptSecret, sha256 } from "../crypto/vault";
import { enqueue } from "../jobs/queue";
import { log } from "../log";
import { verifyChatwootSignature } from "./webhook";

const MAX_BODY = 512 * 1024;

/**
 * Receptor de eventos Chatwoot: autentica (firma HMAC + mapeo de cuenta), deduplica
 * y encola. Responde rápido; el procesamiento ocurre en el worker.
 */
export async function receiveChatwootWebhook(input: { key: string; rawBody: string; signature: string | null; timestamp: string | null; deliveryId: string | null }) {
  if (!input.key || input.key.length > 64) return { status: 404, body: { error: "not_found" } };
  if (input.rawBody.length > MAX_BODY) return { status: 413, body: { error: "too_large" } };
  const mapping = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.webhookKey, input.key) });
  if (!mapping || !mapping.webhookSecretEnc) return { status: 404, body: { error: "not_found" } };
  const secret = decryptSecret(mapping.webhookSecretEnc, `cwwh:${mapping.tenantId}`);
  const check = verifyChatwootSignature({ secret, rawBody: input.rawBody, signature: input.signature, timestamp: input.timestamp });
  if (!check.ok) {
    log.warn("chatwoot.webhook.rejected", { reason: check.reason, tenantId: mapping.tenantId });
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let payload: { event?: string; account?: { id?: number }; id?: number };
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const event = String(payload.event ?? "unknown");
  // La cuenta del evento debe coincidir con la cuenta mapeada a este tenant.
  if (payload.account?.id !== undefined && payload.account.id !== mapping.chatwootAccountId) {
    log.warn("chatwoot.webhook.account_mismatch", { tenantId: mapping.tenantId });
    return { status: 403, body: { error: "account_mismatch" } };
  }
  const dedupKey = input.deliveryId ? `cw:${mapping.chatwootAccountId}:d:${input.deliveryId}` : `cw:${mapping.chatwootAccountId}:b:${sha256(input.rawBody)}`;
  const inserted = await db
    .insert(webhookEvents)
    .values({ tenantId: mapping.tenantId, source: "chatwoot", deliveryId: input.deliveryId, dedupKey, event, payload })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return { status: 200, body: { ok: true, duplicate: true } };
  await enqueue("chatwoot.event", { webhookEventId: inserted[0].id }, { tenantId: mapping.tenantId, dedupKey: `evt:${inserted[0].id}` });
  return { status: 200, body: { ok: true } };
}
