import "server-only";
import type { AiProviderKind } from "../db/schema";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./types";

export const PROVIDER_INFO: Record<AiProviderKind, { label: string; defaultBaseUrl: string; baseUrlEditable: boolean; modelHint: string }> = {
  openai_compatible: { label: "OpenAI o compatible (Chat Completions)", defaultBaseUrl: "https://api.openai.com/v1", baseUrlEditable: true, modelHint: "p. ej. gpt-4o-mini" },
  anthropic: { label: "Anthropic (Claude)", defaultBaseUrl: "https://api.anthropic.com", baseUrlEditable: false, modelHint: "p. ej. claude-haiku-4-5" },
  gemini: { label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com", baseUrlEditable: false, modelHint: "p. ej. gemini-2.5-flash" },
};

/** Las URLs fijas de Anthropic/Gemini solo se reemplazan en tests (AI_TEST_BASE_URL_OVERRIDE). */
function fixedBase(kind: "anthropic" | "gemini") {
  const override = process.env.NODE_ENV !== "production" ? process.env[`AI_TEST_${kind.toUpperCase()}_BASE_URL`] : undefined;
  return override || PROVIDER_INFO[kind].defaultBaseUrl;
}

export function buildProvider(kind: AiProviderKind, apiKey: string, baseUrl: string | null): AiProvider {
  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 20000);
  switch (kind) {
    case "openai_compatible":
      return new OpenAiCompatibleProvider(apiKey, baseUrl || PROVIDER_INFO.openai_compatible.defaultBaseUrl, timeout);
    case "anthropic":
      return new AnthropicProvider(apiKey, fixedBase("anthropic"), timeout);
    case "gemini":
      return new GeminiProvider(apiKey, fixedBase("gemini"), timeout);
  }
}
