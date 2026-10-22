/**
 * Parámetros que admite cada proveedor/modelo. Se muestra "no disponible" en lugar de simular
 * compatibilidad. Para proveedores compatibles con OpenAI que no conocemos, el valor se intenta y,
 * si el proveedor lo rechaza, se omite automáticamente (se informa así en la interfaz).
 */
export type ParamSupport = "yes" | "no" | "try";

export function modelCapabilities(provider: string, model: string, baseUrl: string | null): { temperature: ParamSupport; maxTokens: ParamSupport; note: string } {
  const m = model.toLowerCase();
  if (provider === "anthropic") return { temperature: "yes", maxTokens: "yes", note: "Anthropic admite temperatura (0 a 1) y límite de tokens." };
  if (provider === "gemini") return { temperature: "yes", maxTokens: "yes", note: "Gemini admite temperatura y límite de tokens." };
  const official = !baseUrl || /(^|\/\/)api\.openai\.com/.test(baseUrl);
  const reasoning = /^(o\d|gpt-5|gpt-6)/.test(m);
  if (official && reasoning) return { temperature: "no", maxTokens: "yes", note: "Este modelo de OpenAI solo usa la temperatura por defecto: el valor se ignora." };
  if (official) return { temperature: "yes", maxTokens: "yes", note: "OpenAI admite temperatura y límite de tokens para este modelo." };
  return { temperature: "try", maxTokens: "try", note: "Proveedor compatible con OpenAI: se envía el valor y, si el proveedor no lo admite, se omite automáticamente." };
}
