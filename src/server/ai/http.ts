import "server-only";
import { AiProviderError } from "./types";

export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal, redirect: "error" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new AiProviderError("timeout", "El proveedor de IA no respondió a tiempo.");
    throw new AiProviderError("network", "No se pudo conectar con el proveedor de IA.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
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
