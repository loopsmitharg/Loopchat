import { LEXICONS, type Lexicon } from "./lexicons";

/**
 * Detección local de insultos y agresiones verbales (sin IA ni servicios externos).
 *
 * Normaliza el texto para resistir evasiones habituales (mayúsculas, tildes, Unicode
 * compatible, caracteres invisibles, homoglifos cirílicos, sustituciones 0→o 1→i 3→e 4→a 5→s
 * 7→t @→a $→s, separadores dentro de la palabra "p.u.t.o", letras espaciadas "p u t o" y
 * letras repetidas "boluuudo") y aplica controles contra falsos positivos: coincidencia por
 * palabra completa (no por subcadena), citas entre comillas, negaciones, verbos de relato,
 * expresiones seguras ("burro de arranque") y términos ignorados (p. ej. nombres de productos).
 * No es perfecta: ver docs/insult-detection.md.
 */

export type InsultMatch = { term: string; lang: string; kind: "strong" | "mild" | "phrase" | "custom" };
export type InsultResult = { flagged: boolean; matches: InsultMatch[] };
export type InsultOptions = {
  /** Términos extra (se tratan como ofensivos por sí mismos). */
  extraTerms?: string[];
  /** Términos a ignorar (palabras o frases): nunca disparan una derivación. */
  ignoredTerms?: string[];
  lexicons?: Lexicon[];
};

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁤⁦-⁯︀-️﻿]/g;
const HOMOGLYPHS: Record<string, string> = { а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", к: "k", м: "m", т: "t", в: "b", н: "h", ß: "ss" };
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "€": "e", "|": "l" };
const QUOTED = /"[^"\n]{1,200}"|“[^”\n]{1,200}”|«[^»\n]{1,200}»|„[^“\n]{1,200}“|'[^'\n]{2,200}'|‘[^’\n]{1,200}’/g;

/** Normalización base: Unicode compatible, sin invisibles, minúsculas, sin tildes, homoglifos. */
export function baseNormalize(text: string) {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[аеорсухіјѕкмтвнß]/g, (c) => HOMOGLYPHS[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

/** Colapsa letras repetidas ("boluuudo" → "boludo"); se aplica igual a texto y diccionarios. */
const collapse = (w: string) => w.replace(/(\p{L})\1+/gu, "$1");

/** Convierte un fragmento crudo en palabra: leet dentro de palabras con letras, sin separadores internos. */
function cleanToken(raw: string): string {
  const hasLetter = /\p{L}/u.test(raw);
  if (!hasLetter) return raw.replace(/[^\p{L}\p{N}]/gu, "");
  let t = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (LEET[c] !== undefined) t += LEET[c];
    else if (c === "!" && /\p{L}/u.test(raw[i - 1] ?? "") && /\p{L}/u.test(raw[i + 1] ?? "")) t += "i";
    else t += c;
  }
  // separadores dentro de la palabra: "p.u.t.o", "h-d-p", "p*ta" (el asterisco se descarta)
  return t.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Texto → lista de palabras normalizadas (sin letras repetidas). */
export function tokenize(text: string): string[] {
  return tokenizeClauses(text).map((t) => t.w);
}

/** Igual que tokenize pero conservando a qué cláusula pertenece cada palabra (separadas por . , ; : ! ? y saltos de línea). */
function tokenizeClauses(text: string): { w: string; c: number }[] {
  const out: { w: string; c: number }[] = [];
  baseNormalize(text)
    .split(/[\n,;:?¿¡]+|!+(?=\s|$)|\.(?=\s|$)/u)
    .forEach((clause, c) => {
      for (const raw of clause.split(/[\s()[\]{}<>"“”«»/\\]+/u)) {
        const w = collapse(cleanToken(raw));
        if (w) out.push({ w, c });
      }
    });
  return out;
}

type Prepared = {
  lex: Lexicon;
  strong: Set<string>;
  mild: Set<string>;
  phrases: string[][];
  safe: string[][];
  cues: Set<string>;
  neg: Set<string>;
  report: Set<string>;
};

const prepCache = new WeakMap<Lexicon, Prepared>();
const normWord = (w: string) => collapse(cleanToken(baseNormalize(w)));
const normPhrase = (p: string) => tokenize(p);

function prepare(lex: Lexicon): Prepared {
  const hit = prepCache.get(lex);
  if (hit) return hit;
  const p: Prepared = {
    lex,
    strong: new Set(lex.strong.map(normWord)),
    mild: new Set(lex.mild.map(normWord)),
    phrases: lex.phrases.map(normPhrase).filter((x) => x.length),
    safe: lex.safePhrases.map(normPhrase).filter((x) => x.length),
    cues: new Set(lex.directedCues.map(normWord)),
    neg: new Set(lex.negations.map(normWord)),
    report: new Set(lex.reportCues.map(normWord)),
  };
  prepCache.set(lex, p);
  return p;
}

/** ¿El token coincide con el término? Incluye plural y cambio de género o/a. */
function wordMatches(token: string, term: string) {
  if (token === term) return true;
  if (token === `${term}s` || token === `${term}es`) return true;
  // cambio de género solo en términos largos: evita "rata" → "rato"
  if (term.length >= 5 && /[oa]$/.test(term)) {
    const stem = term.slice(0, -1);
    return token === `${stem}o` || token === `${stem}a` || token === `${stem}os` || token === `${stem}as`;
  }
  return false;
}

function findSeq(tokens: string[], seq: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + seq.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (!(j === seq.length - 1 ? wordMatches(tokens[i + j], seq[j]) : tokens[i + j] === seq[j])) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Une letras sueltas consecutivas ("p u t o") cuando forman un término conocido. */
function joinSpacedLetters(tokens: { w: string; c: number }[], known: (w: string) => boolean) {
  const out: { w: string; c: number }[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i].w.length === 1) {
      let j = i;
      while (j < tokens.length && tokens[j].w.length === 1) j++;
      if (j - i >= 3) {
        const joined = collapse(tokens.slice(i, j).map((t) => t.w).join(""));
        if (known(joined)) {
          out.push({ w: joined, c: tokens[i].c });
          i = j;
          continue;
        }
      }
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

/** Palabras de relleno entre el indicador de segunda persona y el insulto ("sos UN re boludo", "you ARE SO stupid"). */
const FILLERS = new Set(
  ["un", "una", "unos", "unas", "re", "muy", "tan", "mas", "bien", "de", "el", "la", "terrible", "flor", "the", "a", "an", "so", "such", "really", "very", "are", "is", "r", "um", "uma", "uns", "umas", "muito", "tao", "une", "des", "si", "tres", "trop", "ein", "eine", "ganz", "echt", "sehr", "uno", "molto", "cosi", "proprio", "total", "totale", "complete", "completo"].map(collapse),
);

export function detectInsult(text: string, opts: InsultOptions = {}): InsultResult {
  if (!text || !text.trim()) return { flagged: false, matches: [] };
  const lexicons = (opts.lexicons ?? LEXICONS).map(prepare);
  // lo citado entre comillas se considera mención, no agresión
  const unquoted = text.replace(QUOTED, " ");
  const ignored = (opts.ignoredTerms ?? []).map(normPhrase).filter((x) => x.length);
  const extra = (opts.extraTerms ?? []).map(normPhrase).filter((x) => x.length);

  const isKnown = (w: string) => lexicons.some((p) => [...p.strong, ...p.mild].some((t) => wordMatches(w, t))) || extra.some((e) => e.length === 1 && wordMatches(w, e[0]));
  const toks = joinSpacedLetters(tokenizeClauses(unquoted), isKnown);
  const tokens = toks.map((t) => t.w);
  if (!tokens.length) return { flagged: false, matches: [] };

  // posiciones neutralizadas: términos ignorados y expresiones seguras
  const blocked = new Set<number>();
  const block = (seqs: string[][]) => {
    for (const seq of seqs) for (const i of findSeq(tokens, seq)) for (let k = 0; k < seq.length; k++) blocked.add(i + k);
  };
  block(ignored);
  for (const p of lexicons) block(p.safe);

  const matches: InsultMatch[] = [];
  const add = (m: InsultMatch) => {
    if (!matches.some((x) => x.term === m.term && x.lang === m.lang)) matches.push(m);
  };
  const free = (i: number, len: number) => ![...Array(len).keys()].some((k) => blocked.has(i + k));

  // 1) frases (insultos compuestos y amenazas) y términos extra de la empresa
  for (const p of lexicons) for (const seq of p.phrases) for (const i of findSeq(tokens, seq)) if (free(i, seq.length)) add({ term: seq.join(" "), lang: p.lex.lang, kind: "phrase" });
  for (const seq of extra) for (const i of findSeq(tokens, seq)) if (free(i, seq.length)) add({ term: seq.join(" "), lang: "custom", kind: "custom" });

  // 2) palabras sueltas, evaluadas dentro de su cláusula (negación, relato, dirección)
  const sameClauseBefore = (i: number, n: number) => {
    const out: string[] = [];
    for (let k = i - 1; k >= 0 && out.length < n && toks[k].c === toks[i].c; k--) out.unshift(tokens[k]);
    return out;
  };
  tokens.forEach((tok, i) => {
    if (blocked.has(i)) return;
    for (const p of lexicons) {
      const strong = [...p.strong].find((t) => wordMatches(tok, t));
      const mild = strong ? undefined : [...p.mild].find((t) => wordMatches(tok, t));
      if (!strong && !mild) continue;
      const before = sameClauseBefore(i, 4);
      if (before.slice(-3).some((w) => p.neg.has(w))) continue;
      if (strong) {
        add({ term: strong, lang: p.lex.lang, kind: "strong" });
        continue;
      }
      if (before.some((w) => p.report.has(w))) continue;
      // dirigido: el primer token previo que no es relleno es un indicador de segunda persona
      let directed = false;
      for (let k = before.length - 1, fill = 0; k >= 0; k--) {
        if (p.cues.has(before[k])) {
          directed = true;
          break;
        }
        if (FILLERS.has(before[k]) && ++fill <= 3) continue;
        break;
      }
      const standalone = tokens.length <= 2;
      if (directed || standalone) add({ term: mild!, lang: p.lex.lang, kind: "mild" });
    }
  });

  return { flagged: matches.length > 0, matches };
}

/** Idiomas cubiertos (para mostrar en la interfaz y documentar). */
export const INSULT_LANGUAGES = LEXICONS.map((l) => ({ lang: l.lang, label: l.label }));
