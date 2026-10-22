import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "../crypto/vault";

export const MAX_SKEW_SECONDS = 300;

/**
 * Verificación de la firma real de Chatwoot (lib/webhooks/trigger.rb, v4.19):
 *   X-Chatwoot-Timestamp: <unix>
 *   X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")
 */
export function verifyChatwootSignature(input: { secret: string; rawBody: string; signature: string | null; timestamp: string | null; now?: number }) {
  if (!input.signature || !input.timestamp) return { ok: false as const, reason: "missing_signature" };
  if (!/^\d{9,11}$/.test(input.timestamp)) return { ok: false as const, reason: "bad_timestamp" };
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(input.timestamp)) > MAX_SKEW_SECONDS) return { ok: false as const, reason: "stale_timestamp" };
  const expected = "sha256=" + createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
  if (!safeEqual(expected, input.signature)) return { ok: false as const, reason: "bad_signature" };
  return { ok: true as const };
}

export function signChatwootPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    "X-Chatwoot-Timestamp": String(timestamp),
    "X-Chatwoot-Signature": "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
  };
}
