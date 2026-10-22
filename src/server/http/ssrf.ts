import "server-only";
import { isIP } from "node:net";
import { badRequest } from "./errors";

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
  return false;
}

/**
 * Protección SSRF para URLs configurables (base URL de proveedores IA compatibles).
 * En producción exige https y bloquea hosts privados; LOOPCHAT_ALLOW_PRIVATE_URLS solo en dev/test.
 * `chatwoot` es configuración del operador (env), por eso permite red privada (p.ej. Docker).
 */
export function assertSafeOutboundUrl(raw: string, opts: { purpose: "ai" | "chatwoot" | "meta" }) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest("URL inválida.");
  }
  if (u.username || u.password) throw badRequest("La URL no puede incluir credenciales.");
  const allowPrivate = process.env.LOOPCHAT_ALLOW_PRIVATE_URLS === "true" && process.env.NODE_ENV !== "production";
  if (opts.purpose === "chatwoot") {
    if (!["http:", "https:"].includes(u.protocol)) throw badRequest("Protocolo no permitido.");
    return u;
  }
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) throw badRequest("La URL debe usar https.");
  if (isPrivateHost(u.hostname) && !allowPrivate) throw badRequest("La URL apunta a una red privada y no está permitida.");
  return u;
}
