/**
 * Validación comercial de la respuesta de la IA ANTES de enviarla al cliente (no depende de que el
 * modelo obedezca el prompt). Solo mira afirmaciones comerciales verificables: importes, descuentos,
 * stock/disponibilidad, confirmaciones de venta y plazos de entrega. Números que no son comerciales
 * (medidas, modelos, fechas, cantidades) no se tocan.
 *
 * Fuentes autorizadas: precios y stock del catálogo de este turno y textos cargados por la empresa
 * (conocimiento, instrucciones del bot, políticas y reglas). Lo que no se puede verificar no se
 * envía como hecho confirmado.
 */
export type CommercialFacts = {
  /** Precios unitarios de los productos en contexto. */
  prices: number[];
  /** Stock conocido de los productos en contexto (null = sin información). */
  stocks: (number | null)[];
  /** Textos cargados por la empresa (conocimiento, instrucciones, políticas, descripciones). */
  authorizedText: string;
};

export type CommercialViolation = { kind: "amount" | "discount" | "sale_confirmation" | "stock" | "delivery"; text: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "85.000" → 85000 · "1.250,50" → 1250.5 · "85,000" → 85000 · "1,5" → 1.5 */
export function parseAmount(raw: string): number | null {
  const t = raw.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let n: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    n = t.replace(new RegExp(`\\${dec === "." ? "," : "."}`, "g"), "").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const thousands = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(t);
    n = thousands ? t.split(sep).join("") : t.replace(sep, ".");
  } else n = t;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

const CURRENCY = String.raw`(?:US\$|U\$S|USD|ARS|AR\$|\$|€|EUR)`;
const NUM = String.raw`(\d[\d.,]*\d|\d)`;
const MONEY_RE = new RegExp(String.raw`${CURRENCY}\s?${NUM}(\s?mil\b)?|${NUM}(\s?mil)?\s?(?:pesos|ars|usd|d[oó]lares|euros)\b`, "gi");

/** Importes con moneda en un texto (con multiplicador "mil"). */
export function moneyAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const raw = m[1] ?? m[3];
    const mil = Boolean(m[2] ?? m[4]);
    const v = raw ? parseAmount(raw) : null;
    if (v !== null) out.push(mil ? v * 1000 : v);
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005);

const DISCOUNT = /descuento|\bdto\b|bonificaci|rebaj|\boff\b|\bpromo|oferta|precio especial|mas barato|te lo dejo (a|en)|\d+\s?x\s?\d+\b|sin interes/;
const NEGATED_DISCOUNT = /\b(no|sin|ningun|ninguna)\b[^.!?\n]{0,35}(descuento|bonificaci|rebaj|promo|oferta)|no (puedo|podemos|tenemos|hay|hacemos|ofrecemos|manejamos|contamos)\b/;
const SALE_CONFIRM =
  /\b(compra|venta|pedido|orden|reserva|pago|operacion)\s+(?:(?:esta|quedo|fue|ya esta|ya quedo)\s+)?(confirmad|cerrad|realizad|registrad|aprobad|procesad|acreditad)[oa]s?\b|\bya (esta|quedo|quedaron|estan)\s+(reservad|confirmad|pagad|vendid|apartad)/;
/** Pretérito con tilde ("te lo reservé") sobre el texto original: sin tilde es subjuntivo ("¿te lo reserve?"). */
const SALE_CONFIRM_PAST = /\b(te|lo|la|los|las)\s+(reservé|confirmé|aparté|vendí)(?![\p{L}])/iu;
const STOCK_QTY = /\b(\d{1,6})\s+(unidades|disponibles|en stock|en existencia)\b/g;
const AVAILABLE = /\b(hay stock|tenemos stock|con stock|en stock|tenemos disponible|esta disponible|estan disponibles|disponible para entrega|lo tenemos|los tenemos|las tenemos)\b/;
const NEGATED_STOCK = /\b(no|sin)\b[^.!?\n]{0,20}(stock|disponib|tenemos)|\bagotad/;
const DELIVERY = /\b(llega|llegan|llegaria|llegara|entrega|entregamos|envio|enviamos|despach\w*|te lo mand\w*|te los mand\w*)\b[^.!?\n]{0,50}?\b(hoy|manana|en el dia|en (\d+)\s*(h|hs|horas|dias)( habiles)?|(\d+)\s*(h|hs|horas|dias)( habiles)?)\b/;

export function checkCommercialClaims(reply: string, facts: CommercialFacts): { ok: boolean; violations: CommercialViolation[] } {
  const violations: CommercialViolation[] = [];
  const auth = norm(facts.authorizedText);
  const allowedAmounts = [...facts.prices.flatMap((p) => Array.from({ length: 50 }, (_, k) => p * (k + 1))), ...moneyAmounts(facts.authorizedText), ...[...auth.matchAll(/\d[\d.,]*/g)].map((m) => parseAmount(m[0])).filter((x): x is number => x !== null && x >= 1)];
  const authPercents = new Set([...auth.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => parseAmount(m[1])));

  // 1) importes: deben coincidir con un precio del catálogo (o múltiplo) o figurar en un texto de la empresa
  for (const a of moneyAmounts(reply)) {
    if (!allowedAmounts.some((x) => close(a, x))) violations.push({ kind: "amount", text: `importe no verificado: ${a}` });
  }

  for (const sentence of reply.split(/(?<=[.!?\n])/)) {
    const s = norm(sentence);
    // 2) descuentos y promociones
    if (DISCOUNT.test(s) && !NEGATED_DISCOUNT.test(s)) {
      const percents = [...s.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%/g)].map((m) => parseAmount(m[1]));
      if (percents.length) {
        for (const p of percents) if (!authPercents.has(p)) violations.push({ kind: "discount", text: `descuento no autorizado: ${p}%` });
      } else if (!DISCOUNT.test(auth)) violations.push({ kind: "discount", text: "promete un descuento o promoción que la empresa no cargó" });
    }
    // 3) confirmar ventas/reservas/pagos lo hace una persona
    // (una pregunta u ofrecimiento al cliente no confirma nada)
    if (!/[?¿]/.test(sentence) && (SALE_CONFIRM.test(s) || SALE_CONFIRM_PAST.test(sentence))) violations.push({ kind: "sale_confirmation", text: "confirma una venta, reserva o pago" });
    // 4) stock: cantidades exactas del catálogo; disponibilidad solo con stock informado
    if (!NEGATED_STOCK.test(s)) {
      for (const m of s.matchAll(STOCK_QTY)) {
        const q = Number(m[1]);
        if (!facts.stocks.some((x) => x === q)) violations.push({ kind: "stock", text: `stock no verificado: ${q}` });
      }
      if (AVAILABLE.test(s) && !facts.stocks.some((x) => x !== null && x > 0)) violations.push({ kind: "stock", text: "afirma disponibilidad sin stock informado" });
    }
    // 5) plazos de entrega: solo los que la empresa informó
    const d = s.match(DELIVERY);
    if (d && !auth.includes(d[2].replace(/\s+/g, " "))) violations.push({ kind: "delivery", text: `plazo de entrega no informado por la empresa: ${d[2]}` });
  }
  return { ok: violations.length === 0, violations };
}
