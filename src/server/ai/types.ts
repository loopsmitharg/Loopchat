export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
};

export type ChatResult = { text: string; inputTokens?: number; outputTokens?: number; model: string };

export class AiProviderError extends Error {
  constructor(public readonly kind: "auth" | "rate_limit" | "timeout" | "network" | "bad_request" | "server" | "invalid_response", message: string, public readonly status?: number) {
    super(message);
  }
  get retryable() {
    return this.kind === "rate_limit" || this.kind === "timeout" || this.kind === "network" || this.kind === "server";
  }
}

export interface AiProvider {
  readonly kind: "openai_compatible" | "anthropic" | "gemini";
  chat(req: ChatRequest): Promise<ChatResult>;
  /** Verifica credenciales con una llamada mínima (cuenta como llamada al proveedor). */
  verify(model: string): Promise<{ ok: true } | { ok: false; error: string }>;
}
