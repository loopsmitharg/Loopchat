import { describe, expect, it } from "vitest";
import { resolveCompanyProfile } from "@/lib/ai-profile";
import { mergeBotConfig, resolveBotConfig } from "@/lib/bot-config";
import { buildPolicy } from "@/lib/instructions/build";
import { previewSamples, resolvePersona } from "@/lib/instructions/persona";
import { styleBlock } from "@/lib/bot-style";

const base = (patch = {}) => mergeBotConfig({}, patch);

describe("personalidad: los selectores se traducen a instrucciones", () => {
  it("un bot existente (sin dimensiones nuevas) conserva exactamente su estilo anterior", () => {
    const cfg = resolveBotConfig({});
    expect(styleBlock(cfg.personality)).toBe("Idioma principal: español. Si el cliente escribe en otro idioma, respondé en el idioma del cliente. Tono profesional y cercano. Respuestas breves: máximo 3 oraciones. Como mucho un emoji ocasional.");
    const p = buildPolicy({ role: "custom", botName: "Bot", config: cfg, customInstructions: "Vendemos herramientas." });
    expect(p.sections.map((s) => s.key)).toEqual(["platform", "role", "style", "custom"]);
    expect(p.text).toContain("Vendemos herramientas.");
  });

  it("formalidad, trato, actitud, iniciativa, intensidad comercial y estilo cambian el texto", () => {
    const cfg = base({ personality: { formality: "very_formal", attitudes: ["calm", "empathetic"], initiative: "consultive", salesIntensity: "consultive", style: "explanatory", emojis: "none", length: "medium" } });
    const r = resolvePersona(cfg.personality, "sales");
    const t = r.lines.join(" ");
    expect(t).toContain("Muy formal");
    expect(t).toContain("Tratá al cliente de usted."); // muy formal sin trato elegido → usted
    expect(t).toContain("tranquilo y paciente");
    expect(t).toContain("Hacé preguntas útiles");
    expect(t).toContain("Ofrecé productos solo si el cliente muestra interés");
    expect(t).toContain("Estilo explicativo");
    expect(t).toContain("No uses emojis.");
    const informal = resolvePersona(base({ personality: { formality: "informal", address: "vos" } }).personality, "sales").lines.join(" ");
    expect(informal).toContain("Informal y amistoso.");
    expect(informal).toContain("Tratá al cliente de vos");
  });

  it("resuelve configuraciones incompatibles y lo explica", () => {
    const rec = resolvePersona(base({ personality: { salesIntensity: "intensive" } }).personality, "receptionist");
    expect(rec.salesIntensity).toBe("none");
    expect(rec.notes.map((n) => n.field)).toContain("salesIntensity");
    const sup = resolvePersona(base({ personality: { attitudes: ["persuasive", "empathetic"], salesIntensity: "sales" } }).personality, "support");
    expect(sup.attitudes).toEqual(["empathetic"]);
    expect(sup.salesIntensity).toBe("consultive");
    expect(sup.lines.join(" ")).toContain("Durante un reclamo o un problema no ofrezcas ventas.");
    const formal = resolvePersona(base({ personality: { formality: "formal", emojis: "free" } }).personality, "sales");
    expect(formal.emojis).toBe("few");
    const mixed = resolvePersona(base({ personality: { attitudes: ["serious", "enthusiastic"] } }).personality, "sales");
    expect(mixed.attitudes).toEqual(["serious"]);
    const brand = resolveCompanyProfile({ brand: { emojis: "none", formality: "formal", avoidExpressions: ["barato"] } }).brand;
    const capped = resolvePersona(base({ personality: { emojis: "free" } }).personality, "sales", brand);
    expect(capped.emojis).toBe("none");
    expect(capped.lines.join(" ")).toContain('"barato"');
    expect(capped.lines.join(" ")).toContain("Formal y respetuoso."); // heredado de la marca
  });

  it("vista previa orientativa según el trato", () => {
    const u = previewSamples(resolvePersona(base({ personality: { address: "usted" } }).personality, "sales"), "sales");
    expect(u[0].text).toContain("Cuénteme");
    const v = previewSamples(resolvePersona(base({ personality: { address: "vos" } }).personality, "sales"), "sales", { displayName: "Sofi" });
    expect(v[0].text).toContain("Contame");
    expect(v[0].text).toContain("Sofi");
  });
});

describe("motor de instrucciones: jerarquía y herencia", () => {
  const company = {
    name: "Ferretería Norte",
    profile: resolveCompanyProfile({ identity: { description: "Ferretería de barrio" }, objectives: { primary: "increase_sales", statement: "Vender sin presionar" } }),
    rules: [
      { id: "r1", text: "No prometer plazos de entrega.", category: "delivery" as const },
      { id: "r2", text: "Regla que pasó a obligatoria.", category: "other" as const },
    ],
  };
  const mandatory = [
    { id: "m1", text: "No ofrecer descuentos sin autorización.", category: "discounts" as const },
    { id: "r2", text: "Regla que pasó a obligatoria.", category: "other" as const },
  ];

  it("orden: plataforma > obligatorias > empresa > equipo > bot; la obligatoria no se repite", () => {
    const p = buildPolicy({
      role: "sales",
      botName: "Ventas",
      config: base({ identity: { goals: ["qualify"] }, behavior: { do: ["Consultar el catálogo antes de informar precios."], dont: ["No inventar productos."], handoffWhen: ["needs_authorization"] } }),
      customInstructions: "Intentá cerrar ventas con las mejores condiciones disponibles.",
      company,
      mandatoryRules: mandatory,
      team: { name: "Equipo", members: [{ name: "Ventas", role: "sales", self: true }, { name: "Soporte", role: "support", self: false }] },
    });
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(["platform", "mandatory", "company", "team", "role", "style", "behavior", "custom"]);
    expect(p.text.indexOf("No ofrecer descuentos sin autorización")).toBeLessThan(p.text.indexOf("Intentá cerrar ventas"));
    expect(p.text.match(/Regla que pasó a obligatoria/g)).toHaveLength(1);
    expect(p.text).toContain("calificar al interesado");
    expect(p.text).toContain("Pedí una persona (handoff) cuando:");
    expect(p.text).toContain("Soporte (Soporte técnico)");
  });

  it("el objetivo comercial de la empresa no convierte a soporte en vendedor", () => {
    const p = buildPolicy({ role: "support", botName: "Soporte", config: base({}), customInstructions: "", company, mandatoryRules: [] });
    expect(p.text).toContain("Aplicá estos objetivos solo dentro de tu función");
    expect(p.notes.map((n) => n.field)).toContain("objectives");
  });
});
