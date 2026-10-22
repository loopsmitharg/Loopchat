import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Normaliza un teléfono a E.164. Por defecto asume Argentina si no trae prefijo internacional. */
export function toE164(raw: string | null | undefined, defaultCountry: "AR" = "AR"): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const withPlus = /^\d{10,15}$/.test(cleaned) && cleaned.length >= 11 ? `+${cleaned}` : cleaned;
  const p = parsePhoneNumberFromString(withPlus, defaultCountry);
  if (!p || !p.isPossible()) return null;
  let e164 = p.number as string;
  // WhatsApp entrega números argentinos móviles como +549XXXXXXXXXX; libphonenumber los mantiene.
  if (!/^\+\d{8,15}$/.test(e164)) return null;
  e164 = e164.replace(/\s/g, "");
  return e164;
}

export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "—";
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}
