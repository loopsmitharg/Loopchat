import { tokenize } from "@/lib/moderation/detect";
import type { TeamIntent } from "./types";

/**
 * Clasificación determinística de intención (sin IA). Se usa primero; la IA solo se consulta
 * si las reglas no alcanzan. Un problema con una compra (falla, reclamo, devolución) tiene
 * prioridad sobre señales de venta: "compré una amoladora y dejó de funcionar" NO es venta,
 * aunque mencione un producto o un precio.
 */
type Rule = { intent: TeamIntent; phrases: string[] };

const RULES: Rule[] = [
  {
    intent: "soporte",
    phrases: [
      "dejo de funcionar", "no funciona", "no anda", "no prende", "no enciende", "no carga", "se rompio", "esta roto", "esta rota", "se quemo",
      "hace ruido", "falla", "fallando", "reparacion", "reparar", "arreglar", "arreglo", "service", "servicio tecnico", "tecnico", "instalar",
      "instalacion", "configurar", "como se usa", "como usar", "error", "no funciona bien", "se traba", "garantia",
      "doesn't work", "not working", "broken", "repair", "warranty", "não funciona", "quebrou", "conserto",
    ],
  },
  {
    intent: "atencion",
    phrases: [
      "reclamo", "queja", "devolucion", "devolver", "reembolso", "cambio de producto", "cambiar el producto", "no me llego", "no llego", "mi pedido",
      "el pedido", "estado del pedido", "mi envio", "estado del envio", "demora", "factura", "facturacion", "me cobraron", "cobro doble", "cancelar", "anular",
      "compra anterior", "problema con", "complaint", "refund", "return", "my order", "reclamação", "devolução", "meu pedido",
    ],
  },
  { intent: "turnos", phrases: ["turno", "turnos", "agendar", "cita", "sacar un turno", "horario disponible", "appointment", "agendamento"] },
  { intent: "seguimiento", phrases: ["seguimiento", "me iban a llamar", "me iban a contactar", "presupuesto que me pasaron", "me enviaron un presupuesto", "follow up"] },
  {
    intent: "ventas",
    phrases: [
      "precio", "precios", "cuanto sale", "cuanto cuesta", "cuanto vale", "costo", "comprar", "compro", "quiero comprar", "quisiera comprar", "presupuesto",
      "cotizacion", "cotizar", "tienen", "venden", "hay stock", "stock", "disponible", "oferta", "promocion", "descuento", "financiacion", "cuotas",
      "me interesa", "lista de precios", "price", "buy", "quote", "preço", "comprar", "orçamento",
    ],
  },
];

const GREETINGS = new Set(["hola", "buenas", "buen", "dia", "dias", "tardes", "noches", "buenos", "hello", "hi", "ola", "oi", "que", "tal", "como", "estas", "esta", "gracias", "ok", "dale"]);

export type IntentResult = { intent: TeamIntent | null; signals: string[]; trivial: boolean };

function hasPhrase(tokens: string[], phrase: string[]) {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

const prepared = RULES.map((r) => ({ intent: r.intent, phrases: r.phrases.map((p) => ({ raw: p, toks: tokenize(p) })) }));

export function classifyIntent(text: string): IntentResult {
  const tokens = tokenize(text);
  const trivial = tokens.length === 0 || tokens.every((t) => GREETINGS.has(t));
  const hits = new Map<TeamIntent, string[]>();
  for (const r of prepared) {
    for (const p of r.phrases) if (p.toks.length && hasPhrase(tokens, p.toks)) hits.set(r.intent, [...(hits.get(r.intent) ?? []), p.raw]);
  }
  // prioridad: problema con una compra > turnos > seguimiento > ventas
  for (const intent of ["soporte", "atencion", "turnos", "seguimiento", "ventas"] as TeamIntent[]) {
    const s = hits.get(intent);
    if (s?.length) return { intent, signals: [...new Set(s)], trivial };
  }
  return { intent: null, signals: [], trivial };
}

/** Coincidencia de palabras clave de una ruta (frases completas, sin tildes ni mayúsculas). */
export function matchesKeywords(text: string, keywords: string[]) {
  const tokens = tokenize(text);
  return keywords.map((k) => tokenize(k)).filter((k) => k.length).some((k) => hasPhrase(tokens, k));
}
