import "server-only";
import { postJson } from "./http";
import { AiProviderError, type AiProvider, type ChatRequest, type ChatResult } from "./types";

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
};

/** Adaptador nativo de Gemini (generateContent). La clave va en header, nunca en la URL. */
export class GeminiProvider implements AiProvider {
  readonly kind = "gemini" as const;
  constructor(private apiKey: string, private baseUrl = "https://generativelanguage.googleapis.com", private defaultTimeout = 20000) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!/^[a-zA-Z0-9.\-_]+$/.test(req.model)) throw new AiProviderError("bad_request", "Nombre de modelo inválido.");
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 600, temperature: req.temperature ?? 0.3, ...(req.jsonMode ? { responseMimeType: "application/json" } : {}) },
    };
    const json = (await postJson(
      `${this.baseUrl.replace(/\/$/, "")}/v1beta/models/${req.model}:generateContent`,
      { "x-goog-api-key": this.apiKey },
      body,
      req.timeoutMs ?? this.defaultTimeout,
    )) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new AiProviderError("invalid_response", "El proveedor no devolvió texto.");
    return { text, inputTokens: json.usageMetadata?.promptTokenCount, outputTokens: json.usageMetadata?.candidatesTokenCount, model: json.modelVersion ?? req.model };
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
