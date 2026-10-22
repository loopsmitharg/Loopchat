import "server-only";
import { postJson } from "./http";
import { AiProviderError, type AiProvider, type ChatRequest, type ChatResult } from "./types";

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
};

/** Adaptador nativo de la Messages API de Anthropic (contrato distinto a OpenAI). */
export class AnthropicProvider implements AiProvider {
  readonly kind = "anthropic" as const;
  constructor(private apiKey: string, private baseUrl = "https://api.anthropic.com", private defaultTimeout = 20000) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const system = req.jsonMode ? `${req.system}\n\nRespondé únicamente con un objeto JSON válido, sin texto adicional.` : req.system;
    const json = (await postJson(
      `${this.baseUrl.replace(/\/$/, "")}/v1/messages`,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      { model: req.model, system, messages: req.messages, max_tokens: req.maxTokens ?? 600, temperature: req.temperature ?? 0.3 },
      req.timeoutMs ?? this.defaultTimeout,
    )) as AnthropicResponse;
    const text = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (!text) throw new AiProviderError("invalid_response", "El proveedor no devolvió texto.");
    return { text, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens, model: json.model ?? req.model };
  }

  async verify(model: string) {
    try {
      await this.chat({ model, system: "Respondé solo: ok", messages: [{ role: "user", content: "ping" }], maxTokens: 5 });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }
}
