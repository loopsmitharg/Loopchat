import "server-only";
import http from "node:http";
import https from "node:https";
import { allowPrivateUrls, assertSafeOutboundUrl, safeLookup } from "../http/ssrf";
import { AiProviderError } from "./types";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * POST JSON a un proveedor de IA. La URL es configurable por la empresa (BYOK), por eso:
 * valida la URL, resuelve DNS con `safeLookup` en la conexión real (sin rebinding), no sigue
 * redirecciones y limita el tamaño de la respuesta.
 */
function request(url: string, headers: Record<string, string>, payload: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  const u = assertSafeOutboundUrl(url, { purpose: "ai" });
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers },
        timeout: timeoutMs,
        ...(allowPrivateUrls() ? {} : { lookup: safeLookup as never }),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new AiProviderError("bad_request", "El proveedor respondió con una redirección (no permitida).", status));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new AiProviderError("invalid_response", "Respuesta del proveedor demasiado grande."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs);
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "AbortError" })));
    req.on("close", () => clearTimeout(timer));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof AiProviderError) return reject(e);
      if (e.name === "AbortError") return reject(new AiProviderError("timeout", "El proveedor de IA no respondió a tiempo."));
      if (e.code === "SSRF_BLOCKED") return reject(new AiProviderError("bad_request", "La URL del proveedor resuelve a una red privada y no está permitida."));
      reject(new AiProviderError("network", "No se pudo conectar con el proveedor de IA."));
    });
    req.end(payload);
  });
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await request(url, headers, JSON.stringify(body), timeoutMs);
  let json: unknown = null;
  try {
    json = res.text ? JSON.parse(res.text) : null;
  } catch {
    json = null;
  }
  if (res.status < 200 || res.status >= 300) {
    const providerMsg =
      (json as { error?: { message?: string } } | null)?.error?.message ?? (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    const safeMsg = String(providerMsg).slice(0, 200);
    if (res.status === 401 || res.status === 403) throw new AiProviderError("auth", `Credencial rechazada por el proveedor: ${safeMsg}`, res.status);
    if (res.status === 429) throw new AiProviderError("rate_limit", `Límite del proveedor alcanzado: ${safeMsg}`, res.status);
    if (res.status >= 500) throw new AiProviderError("server", `Error del proveedor: ${safeMsg}`, res.status);
    throw new AiProviderError("bad_request", `Solicitud rechazada por el proveedor: ${safeMsg}`, res.status);
  }
  if (json === null) throw new AiProviderError("invalid_response", "Respuesta del proveedor no es JSON.");
  return json;
}
