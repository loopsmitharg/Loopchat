import { describe, expect, it } from "vitest";
import { detectInsult, tokenize } from "@/lib/moderation/detect";

const flagged = (t: string, o?: Parameters<typeof detectInsult>[1]) => detectInsult(t, o).flagged;

describe("detección local de insultos: idiomas cubiertos", () => {
  it.each([
    ["es", "sos un pelotudo"],
    ["es", "la concha de tu madre"],
    ["es", "andate a la mierda"],
    ["es", "son unos ladrones"],
    ["es", "vos sos un re boludo"],
    ["es", "che tarado, respondé"],
    ["es", "eres un imbécil"],
    ["es", "gilipollas"],
    ["es", "te voy a matar"],
    ["en", "you are a fucking idiot"],
    ["en", "fuck off"],
    ["en", "you stupid bot"],
    ["en", "what a piece of shit service"],
    ["pt", "vai se foder"],
    ["pt", "seu idiota"],
    ["pt", "vocês são uns ladrões"],
    ["it", "sei uno stronzo"],
    ["it", "vaffanculo"],
    ["fr", "ta gueule"],
    ["fr", "espèce de con"],
    ["fr", "connard"],
    ["de", "du bist ein Arschloch"],
    ["de", "fick dich"],
  ])("%s: %s", (_lang, text) => {
    expect(flagged(text)).toBe(true);
  });
});

describe("variantes de escritura y evasiones", () => {
  it.each([
    "SOS UN PELOTUDO",
    "sos un pel0tud0",
    "sos un p3l0tud0",
    "sos un pelotuuudo",
    "p.e.l.o.t.u.d.o",
    "p e l o t u d o",
    "idi\u200Bota",
    "ｉｄｉｏｔａ",
    "іdіоtа", // homoglifos cirílicos
    "h.d.p",
    "$ubnormal",
    "f u c k   off",
    "h1j0 d3 put4",
  ])("%s", (text) => {
    expect(flagged(text)).toBe(true);
  });
});

describe("control de falsos positivos", () => {
  it.each([
    "Hola, ¿tienen burro de arranque para un Fiat 147?",
    "Necesito bolsas de basura de 60x90",
    "¿Venden carne de cerdo?",
    "Mi pedido está retrasado, ¿me averiguás?",
    "Quiero una computadora y una manguera con chorro regulable",
    "¿Cuánto sale el collar para perra mediana?",
    "Te escribo en un rato",
    "Te paso el forro del celular que necesito",
    "¿Tienen alimento animal?",
    "no es ninguna estafa, ¿no?",
    "Me dijeron que eran unos chantas pero yo confío",
    "la palabra \"idiota\" no la uso",
    "Hello, I need a garbage bag and a trash can",
    "Quero sacos de lixo",
    "Con tarjeta de crédito, ¿hay cuotas?",
    "es con envío a domicilio",
    "De puta madre, gracias por la ayuda",
    "Scunthorpe y Essex",
  ])("%s", (text) => {
    expect(detectInsult(text)).toEqual({ flagged: false, matches: [] });
  });

  it("los términos ignorados (p. ej. un producto) no derivan; los extra sí", () => {
    expect(flagged("¿Tienen la remera 'Boludo' talle M?")).toBe(false);
    expect(flagged("quiero el modelo Burro", { ignoredTerms: ["modelo burro"] })).toBe(false);
    expect(flagged("sos un burro", { ignoredTerms: ["burro"] })).toBe(false);
    expect(flagged("sos un trucho", { extraTerms: ["trucho"] })).toBe(true);
    expect(flagged("no sos un trucho")).toBe(false);
  });

  it("la negación y el relato se evalúan dentro de la misma cláusula", () => {
    expect(flagged("no. sos un pelotudo")).toBe(true);
    expect(flagged("no sos un pelotudo")).toBe(false);
  });

  it("normaliza a palabras comparables", () => {
    expect(tokenize("¡Hóla, P.E.R.R.O!")).toEqual(["hola", "pero"]);
  });
});
