import type { BotConfig } from "./bot-config";
import { resolvePersona } from "./instructions/persona";

/** Indicaciones de estilo de un bot sin marca ni rol (compatibilidad: mismo texto que antes para bots existentes). */
export function styleBlock(p: BotConfig["personality"]) {
  return resolvePersona(p, "custom", null).lines.join(" ");
}
