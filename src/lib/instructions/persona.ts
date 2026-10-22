import type { CompanyProfile } from "@/lib/ai-profile";
import type { BotConfig } from "@/lib/bot-config";
import { ADDRESS_TEXT, ATTITUDE_LABELS, ATTITUDE_TEXT, EMOJI_TEXT, FORMALITY_TEXT, INCOMPATIBLE_ATTITUDES, INITIATIVE_TEXT, LENGTH_TEXT, SALES_TEXT, STYLE_TEXT } from "./catalog";
import type { AddressValue, AttitudeValue, EmojiValue, FormalityValue, SalesIntensityValue } from "./types";

export type PersonaNote = { field: string; message: string };
export type ResolvedPersona = {
  formality: FormalityValue | null;
  address: AddressValue | null;
  emojis: EmojiValue;
  length: BotConfig["personality"]["length"];
  attitudes: AttitudeValue[];
  salesIntensity: SalesIntensityValue | null;
  /** Indicaciones de estilo que llegan al modelo. */
  lines: string[];
  /** Conflictos detectados y cómo se resolvieron (se muestran en la interfaz). */
  notes: PersonaNote[];
  /** De dónde sale cada valor efectivo. */
  sources: Record<string, "bot" | "brand" | "legacy" | "role">;
};

const LANG: Record<string, string> = { es: "español", en: "inglés", pt: "portugués" };
const EMOJI_ORDER: EmojiValue[] = ["none", "few", "moderate", "free"];
const SALES_ORDER: SalesIntensityValue[] = ["none", "consultive", "moderate", "sales", "intensive"];
const NON_SALES_ROLES = ["support", "customer_service"];

/**
 * Combina la personalidad del bot con la de la marca y el rol, resolviendo conflictos de forma
 * determinística (y explicándolos). Si el bot no usa las dimensiones nuevas, produce las mismas
 * indicaciones que antes (tono heredado), así los bots existentes no cambian.
 */
export function resolvePersona(p: BotConfig["personality"], role: string, brand?: CompanyProfile["brand"] | null): ResolvedPersona {
  const notes: PersonaNote[] = [];
  const sources: ResolvedPersona["sources"] = {};
  const b = p.inheritBrand && brand ? brand : null;
  const lines: string[] = [`Idioma principal: ${LANG[p.language]}.${p.matchCustomerLanguage ? " Si el cliente escribe en otro idioma, respondé en el idioma del cliente." : ""}`];

  // formalidad y tratamiento
  let formality: FormalityValue | null = p.formality;
  let legacyToneLine: string | null = null;
  if (formality) sources.formality = "bot";
  else if (b?.formality) {
    formality = b.formality;
    sources.formality = "brand";
  } else {
    sources.formality = "legacy";
    legacyToneLine = p.tone === "custom" ? (p.customTone.trim() ? `Estilo pedido por la empresa: ${p.customTone.trim()}` : "Tono profesional y cercano.") : p.tone === "formal" ? "Tono formal: tratá al cliente de usted." : p.tone === "informal" ? "Tono informal y amistoso." : "Tono profesional y cercano.";
  }
  let address: AddressValue | null = p.address ?? b?.address ?? null;
  if (p.address) sources.address = "bot";
  else if (b?.address) sources.address = "brand";
  if (formality === "very_formal" && !address) {
    address = "usted";
    sources.address = "role";
  }
  if (address === "usted" && (formality === "informal" || formality === "very_informal")) notes.push({ field: "address", message: "Tono informal con trato de usted: se mantiene el usted y la informalidad se limita a un lenguaje cercano." });
  if (address === "vos" && formality === "very_formal") notes.push({ field: "address", message: "Muy formal con trato de vos: se usa vos con lenguaje cuidado." });
  if (formality) lines.push(FORMALITY_TEXT[formality]);
  else if (legacyToneLine) lines.push(legacyToneLine);
  if (address && !(sources.formality === "legacy" && p.tone === "formal" && address === "usted")) lines.push(ADDRESS_TEXT[address]);

  // actitud (pares incompatibles: se conserva el primero elegido)
  let attitudes = [...p.attitudes];
  for (const [a, c] of INCOMPATIBLE_ATTITUDES) {
    if (attitudes.includes(a) && attitudes.includes(c)) {
      const drop = attitudes.indexOf(a) < attitudes.indexOf(c) ? c : a;
      attitudes = attitudes.filter((x) => x !== drop);
      notes.push({ field: "attitudes", message: `"${ATTITUDE_LABELS[a]}" y "${ATTITUDE_LABELS[c]}" se contradicen: se usa solo "${ATTITUDE_LABELS[attitudes.includes(a) ? a : c]}".` });
    }
  }
  if (NON_SALES_ROLES.includes(role) && attitudes.includes("persuasive")) {
    attitudes = attitudes.filter((x) => x !== "persuasive");
    notes.push({ field: "attitudes", message: "Un bot de soporte o atención no es persuasivo: se quitó esa actitud para no vender durante un reclamo." });
  }
  if (attitudes.length) lines.push(`Actitud: ${attitudes.map((a) => ATTITUDE_TEXT[a]).join("; ")}.${p.attitudeNote.trim() ? ` Matiz: ${p.attitudeNote.trim()}.` : ""}`);
  else if (p.attitudeNote.trim()) lines.push(`Actitud: ${p.attitudeNote.trim()}.`);
  if (b?.personality.trim() && !p.attitudes.length) lines.push(`Personalidad de la marca: ${b.personality.trim()}.`);

  if (p.style) {
    lines.push(STYLE_TEXT[p.style]);
    if (p.style === "explanatory" && p.length === "very_short") notes.push({ field: "style", message: "Estilo explicativo con respuestas muy breves: prevalece la brevedad; explica solo lo indispensable." });
    if (p.style === "persuasive" && NON_SALES_ROLES.includes(role)) notes.push({ field: "style", message: "Estilo persuasivo en un bot de soporte/atención: nunca se aplica durante reclamos." });
  } else if (b?.style.trim()) lines.push(`Estilo de la marca: ${b.style.trim()}.`);

  // extensión y emojis (la marca pone un techo de emojis)
  const length = p.length;
  lines.push(LENGTH_TEXT[length]);
  let emojis = p.emojis;
  if (b?.emojis && EMOJI_ORDER.indexOf(emojis) > EMOJI_ORDER.indexOf(b.emojis)) {
    notes.push({ field: "emojis", message: `La marca limita los emojis a "${b.emojis === "none" ? "nunca" : b.emojis === "few" ? "ocasional" : "moderado"}": se aplica ese máximo.` });
    emojis = b.emojis;
    sources.emojis = "brand";
  }
  if ((formality === "very_formal" || formality === "formal") && EMOJI_ORDER.indexOf(emojis) > 1) {
    notes.push({ field: "emojis", message: "Con un tono formal, los emojis se limitan a uno ocasional." });
    emojis = "few";
  }
  lines.push(EMOJI_TEXT[emojis]);

  if (p.initiative) lines.push(INITIATIVE_TEXT[p.initiative]);

  // intensidad comercial según el rol
  let sales = p.salesIntensity;
  if (sales && role === "receptionist" && sales !== "none") {
    notes.push({ field: "salesIntensity", message: "La recepcionista no vende: deriva al bot de ventas. Se usa “Sin intención comercial”." });
    sales = "none";
    sources.salesIntensity = "role";
  }
  if (sales && NON_SALES_ROLES.includes(role) && SALES_ORDER.indexOf(sales) > 1) {
    notes.push({ field: "salesIntensity", message: "En soporte o atención la intensidad comercial se limita a “Consultiva” y nunca durante un reclamo." });
    sales = "consultive";
    sources.salesIntensity = "role";
  }
  if (sales) lines.push(SALES_TEXT[sales]);
  if (NON_SALES_ROLES.includes(role) || role === "receptionist") lines.push("Durante un reclamo o un problema no ofrezcas ventas.");
  if (sales && SALES_ORDER.indexOf(sales) >= 2) lines.push("Si el cliente rechaza una propuesta o dice que no está interesado, no insistas.");

  if (p.useCustomerName === "always") lines.push("Usá el nombre del cliente cuando lo sepas.");
  if (p.useCustomerName === "never") lines.push("No uses el nombre del cliente.");
  if (p.questionStyle === "one_at_a_time") lines.push("Hacé una sola pregunta por mensaje.");
  const preferred = [...new Set([...(b?.signatureExpressions ?? []), ...p.preferredTerms])];
  const forbidden = [...new Set([...(b?.avoidExpressions ?? []), ...p.forbiddenTerms])];
  if (preferred.length) lines.push(`Expresiones preferidas (usalas con naturalidad, sin forzarlas): ${preferred.map((x) => `"${x}"`).join(", ")}.`);
  if (forbidden.length) lines.push(`Nunca uses estas palabras o expresiones: ${forbidden.map((x) => `"${x}"`).join(", ")}.`);
  if (p.glossary.trim()) lines.push(`Terminología del negocio: ${p.glossary.trim()}`);
  if (b?.greeting.trim()) lines.push(`Forma de saludar de la marca: "${b.greeting.trim()}".`);
  if (b?.farewell.trim()) lines.push(`Forma de despedirse de la marca: "${b.farewell.trim()}".`);
  return { formality, address, emojis, length, attitudes, salesIntensity: sales, lines, notes, sources };
}

/**
 * Ejemplos orientativos (NO generados por IA) de cómo saludaría el bot con su configuración.
 * Se actualizan al instante en la interfaz.
 */
export function previewSamples(r: ResolvedPersona, role: string, opts: { displayName?: string; brandGreeting?: string } = {}) {
  const u = r.address === "usted";
  const t = r.address === "tu";
  const formal = r.formality === "very_formal" || r.formality === "formal" || u;
  const casual = r.formality === "informal" || r.formality === "very_informal";
  const emoji = r.emojis === "none" ? "" : r.emojis === "few" ? "" : " 🙂";
  const hello = opts.brandGreeting?.trim() || (formal ? "Buenos días" : casual ? "¡Hola!" : "¡Hola!");
  const name = opts.displayName?.trim() ? (formal ? ` Mi nombre es ${opts.displayName.trim()}.` : ` Soy ${opts.displayName.trim()}.`) : "";
  const verb = (vos: string, tu: string, usted: string) => (u ? usted : t ? tu : vos);
  const short = r.length === "very_short";
  const greeting =
    role === "receptionist"
      ? `${hello}${name} ${u ? "Bienvenido." : "¡Bienvenido!"} ¿En qué ${u ? "podemos ayudarlo" : verb("te podemos ayudar", "te podemos ayudar", "podemos ayudarlo")}?${emoji}`
      : role === "support"
        ? `${hello}${name} ${verb("Entiendo lo que pasó.", "Entiendo lo que pasó.", "Entiendo lo que sucedió.")}${short ? "" : ` Voy a ${verb("ayudarte", "ayudarte", "ayudarlo")} a revisar el problema paso a paso.`}`
        : role === "customer_service" || role === "aftersales"
          ? `${hello}${name} Lamento el inconveniente.${short ? "" : ` ${verb("Contame", "Cuéntame", "Cuénteme")} qué pasó y lo ${u ? "resolvemos" : "resolvemos juntos"}.`}`
          : role === "sales"
            ? `${hello}${name} ${verb("Contame qué estás buscando", "Cuéntame qué estás buscando", "Cuénteme qué está buscando")}${short ? "." : ` y ${verb("te ayudo", "te ayudo", "lo ayudo")} a encontrar la mejor opción.`}${emoji}`
            : `${hello}${name} ¿En qué ${verb("te puedo ayudar", "te puedo ayudar", "puedo ayudarlo")}?${emoji}`;
  const pushback =
    r.salesIntensity === "intensive" || r.salesIntensity === "sales"
      ? `${verb("Entiendo", "Entiendo", "Comprendo")}. Si ${verb("querés", "quieres", "desea")}, ${verb("te dejo", "te dejo", "le dejo")} las opciones para cuando lo ${verb("necesites", "necesites", "necesite")}.`
      : `Perfecto, cualquier cosa ${verb("me escribís", "me escribes", "me escribe")}.`;
  return [
    { scenario: "Primer mensaje del cliente", text: greeting.replace(/\s+/g, " ").trim() },
    { scenario: "El cliente dice que no le interesa", text: pushback },
  ];
}
