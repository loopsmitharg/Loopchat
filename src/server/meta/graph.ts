import "server-only";
import { assertSafeOutboundUrl } from "../http/ssrf";

export type MetaPhoneInfo = { displayPhoneNumber: string; verifiedName: string | null; qualityRating: string | null };

/**
 * Verificación de solo lectura del número en la Graph API de Meta (no envía mensajes).
 * GET /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating
 */
export async function verifyMetaPhoneNumber(input: { phoneNumberId: string; accessToken: string }): Promise<{ ok: true; info: MetaPhoneInfo } | { ok: false; error: string }> {
  const base = process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v22.0";
  assertSafeOutboundUrl(base, { purpose: "meta" });
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) return { ok: false, error: "El Phone Number ID debe ser numérico." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/${input.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: controller.signal,
      redirect: "error",
    });
    const json = (await res.json().catch(() => null)) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } } | null;
    if (!res.ok) return { ok: false, error: `Meta rechazó la verificación: ${json?.error?.message?.slice(0, 200) ?? `HTTP ${res.status}`}` };
    if (!json?.display_phone_number) return { ok: false, error: "Meta no devolvió el número asociado." };
    return { ok: true, info: { displayPhoneNumber: json.display_phone_number, verifiedName: json.verified_name ?? null, qualityRating: json.quality_rating ?? null } };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "Meta no respondió a tiempo." : "No se pudo conectar con Meta." };
  } finally {
    clearTimeout(timer);
  }
}
