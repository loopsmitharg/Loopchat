import "server-only";
import { postJson } from "./http";
import { AiProviderError, type AiProvider, type ChatRequest, type ChatResult } from "./types";

type OpenAiResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
};

/** Parámetros que cada modelo acepta. Los modelos nuevos de OpenAI (familias GPT-5/6, o-series)
 *  rechazan `max_tokens` y valores de `temperature` distintos al default; los compatibles
 *  (OpenRouter, Groq, DeepSeek…) suelen usar todavía `max_tokens`. Se aprende por modelo. */
type Quirks = { tokenParam: "max_tokens" | "max_completion_tokens"; temperature: boolean; jsonMode: boolean };
const learned = new Map<string, Quirks>();
const MAX_ADAPT = 3;

function isOfficialOpenAi(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

/** Ajusta los parámetros según el error del proveedor. Devuelve null si el error no es de parámetros. */
export function adaptQuirks(q: Quirks, message: string): Quirks | null {
  const m = message.toLowerCase();
  if (m.includes("max_tokens") && q.tokenParam === "max_tokens") return { ...q, tokenParam: "max_completion_tokens" };
  if (m.includes("max_completion_tokens") && q.tokenParam === "max_completion_tokens") return { ...q, tokenParam: "max_tokens" };
  if (m.includes("temperature") && q.temperature) return { ...q, temperature: false };
  if (m.includes("response_format") && q.jsonMode) return { ...q, jsonMode: false };
  return null;
}

/** Contrato Chat Completions de OpenAI (y proveedores compatibles: OpenRouter, Groq, DeepSeek, etc.). */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind = "openai_compatible" as const;
  private readonly official: boolean;
  constructor(private apiKey: string, private baseUrl = "https://api.openai.com/v1", private defaultTimeout = 20000) {
    this.official = isOfficialOpenAi(baseUrl);
  }

  private async complete(req: ChatRequest): Promise<OpenAiResponse> {
    const key = `${this.baseUrl}|${req.model}`;
    let q: Quirks = learned.get(key) ?? { tokenParam: this.official ? "max_completion_tokens" : "max_tokens", temperature: true, jsonMode: true };
    const wanted = req.maxTokens ?? 600;
    for (let attempt = 0; ; attempt++) {
      const body: Record<string, unknown> = { model: req.model, messages: [{ role: "system", content: req.system }, ...req.messages] };
      // En modelos de razonamiento el límite incluye tokens internos: se deja margen (solo se cobra lo usado).
      body[q.tokenParam] = q.tokenParam === "max_completion_tokens" ? Math.max(wanted, 2048) : wanted;
      if (q.temperature) body.temperature = req.temperature ?? 0.3;
      if (req.jsonMode && q.jsonMode) body.response_format = { type: "json_object" };
      try {
        const json = (await postJson(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, body, req.timeoutMs ?? this.defaultTimeout)) as OpenAiResponse;
        learned.set(key, q);
        return json;
      } catch (e) {
        const next = e instanceof AiProviderError && e.kind === "bad_request" && attempt < MAX_ADAPT ? adaptQuirks(q, e.message) : null;
        if (!next) throw e;
        q = next;
      }
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const json = await this.complete(req);
    const choice = json.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string" || (text === "" && choice?.finish_reason === "length")) {
      throw new AiProviderError("invalid_response", choice?.finish_reason === "length" ? "El modelo agotó el límite de tokens sin responder." : "El proveedor no devolvió texto.");
    }
    return { text, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens, model: json.model ?? req.model, truncated: choice?.finish_reason === "length" };
  }

  /** Verifica clave + modelo: basta con que el proveedor acepte la solicitud. */
  async verify(model: string) {
    try {
      await this.complete({ model, system: "Respondé solo: ok", messages: [{ role: "user", content: "ping" }], maxTokens: 16 });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }
}
