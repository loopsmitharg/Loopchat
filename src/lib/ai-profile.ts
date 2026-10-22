import { z } from "zod";

/**
 * Identidad y objetivos de IA de la empresa: base común a todos sus chatbots.
 * Se edita en Configuración → Identidad y objetivos de IA. Los datos que ya existen en el perfil
 * de la empresa (nombre, horarios, zona horaria) NO se duplican acá: se leen de la empresa.
 */
const text = (max: number) => z.string().trim().max(max).default("");
const phrases = z.array(z.string().trim().min(2).max(80)).max(20).default([]);

export const COMPANY_GOALS = ["increase_sales", "acquire_customers", "qualify_leads", "customer_service", "technical_support", "bookings", "followup", "custom"] as const;
export type CompanyGoal = (typeof COMPANY_GOALS)[number];
export const COMPANY_GOAL_LABELS: Record<CompanyGoal, string> = {
  increase_sales: "Aumentar las ventas",
  acquire_customers: "Captar nuevos clientes",
  qualify_leads: "Calificar oportunidades comerciales",
  customer_service: "Brindar atención al cliente",
  technical_support: "Resolver consultas técnicas",
  bookings: "Gestionar reservas o turnos",
  followup: "Realizar seguimiento comercial",
  custom: "Objetivo personalizado",
};
/** Objetivos comerciales: no se aplican a bots cuya función no es vender (soporte, atención, recepción). */
export const COMMERCIAL_GOALS: CompanyGoal[] = ["increase_sales", "acquire_customers", "qualify_leads", "followup"];

export const FORMALITY = ["very_formal", "formal", "professional_warm", "informal", "very_informal"] as const;
export type Formality = (typeof FORMALITY)[number];
export const FORMALITY_LABELS: Record<Formality, string> = { very_formal: "Muy formal", formal: "Formal", professional_warm: "Profesional y cercano", informal: "Informal", very_informal: "Muy informal" };

export const ADDRESS = ["vos", "tu", "usted"] as const;
export type Address = (typeof ADDRESS)[number];
export const ADDRESS_LABELS: Record<Address, string> = { vos: "Vos (rioplatense)", tu: "Tú", usted: "Usted" };

export const EMOJI_LEVELS = ["none", "few", "moderate", "free"] as const;
export type EmojiLevel = (typeof EMOJI_LEVELS)[number];
export const EMOJI_LABELS: Record<EmojiLevel, string> = { none: "Nunca", few: "Ocasional", moderate: "Moderado", free: "Frecuente" };

export const LENGTHS = ["very_short", "short", "medium", "long"] as const;
export type LengthLevel = (typeof LENGTHS)[number];
export const LENGTH_LABELS: Record<LengthLevel, string> = { very_short: "Muy breves", short: "Breves", medium: "Equilibradas", long: "Detalladas" };

export const companyProfileSchema = z.object({
  identity: z
    .object({
      description: text(800),
      activity: text(200),
      offering: text(800),
      audience: text(400),
      valueProposition: text(400),
      differentiators: text(600),
      coverage: text(300),
      languages: z.array(z.enum(["es", "en", "pt"])).max(3).default([]),
      contactChannels: text(300),
      extraInfo: text(1000),
    })
    .prefault({}),
  objectives: z
    .object({
      primary: z.enum(COMPANY_GOALS).nullable().default(null),
      secondary: z.array(z.enum(COMPANY_GOALS)).max(7).default([]),
      customGoal: text(200),
      statement: text(600),
    })
    .prefault({}),
  brand: z
    .object({
      personality: text(400),
      formality: z.enum(FORMALITY).nullable().default(null),
      address: z.enum(ADDRESS).nullable().default(null),
      emojis: z.enum(EMOJI_LEVELS).nullable().default(null),
      length: z.enum(LENGTHS).nullable().default(null),
      style: text(300),
      signatureExpressions: phrases,
      avoidExpressions: phrases,
      greeting: text(200),
      farewell: text(200),
    })
    .prefault({}),
});
export type CompanyProfile = z.output<typeof companyProfileSchema>;
export type CompanyProfileInput = z.input<typeof companyProfileSchema>;

export function resolveCompanyProfile(raw: unknown): CompanyProfile {
  const r = companyProfileSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["identity", "objectives", "brand"] as const) {
    const s = companyProfileSchema.shape[k].safeParse(obj[k] ?? {});
    out[k] = s.success ? s.data : companyProfileSchema.shape[k].parse({});
  }
  return out as CompanyProfile;
}

/** ¿Tiene contenido? (un perfil vacío no cambia las instrucciones de los bots) */
export function profileHasContent(p: CompanyProfile) {
  const id = p.identity;
  const o = p.objectives;
  const b = p.brand;
  return Boolean(
    Object.values(id).some((v) => (Array.isArray(v) ? v.length : String(v).trim())) ||
      o.primary ||
      o.secondary.length ||
      o.statement.trim() ||
      b.personality.trim() ||
      b.formality ||
      b.address ||
      b.emojis ||
      b.length ||
      b.style.trim() ||
      b.signatureExpressions.length ||
      b.avoidExpressions.length ||
      b.greeting.trim() ||
      b.farewell.trim(),
  );
}

export const RULE_CATEGORIES = ["pricing", "stock", "discounts", "payments", "privacy", "delivery", "hours", "handoff", "sales_conduct", "other"] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  pricing: "Precios",
  stock: "Stock y disponibilidad",
  discounts: "Descuentos",
  payments: "Pagos",
  privacy: "Privacidad",
  delivery: "Entregas y plazos",
  hours: "Horarios",
  handoff: "Derivación a personas",
  sales_conduct: "Conducta comercial",
  other: "Otras",
};

export const ruleInputSchema = z.object({
  text: z.string().trim().min(5).max(300),
  category: z.enum(RULE_CATEGORIES).default("other"),
  enabled: z.boolean().default(true),
  mandatory: z.boolean().default(false),
});
export const ruleUpdateSchema = z.object({
  text: z.string().trim().min(5).max(300).optional(),
  category: z.enum(RULE_CATEGORIES).optional(),
  enabled: z.boolean().optional(),
  mandatory: z.boolean().optional(),
});

/** Reglas sugeridas (se agregan solo si la empresa las pide; nunca automáticamente). */
export const SUGGESTED_RULES: { text: string; category: RuleCategory; mandatory: boolean }[] = [
  { text: "No inventar precios: informar solo los precios cargados en el catálogo o el conocimiento.", category: "pricing", mandatory: true },
  { text: "No prometer disponibilidad sin consultar el stock informado.", category: "stock", mandatory: true },
  { text: "No ofrecer descuentos ni condiciones especiales no autorizados.", category: "discounts", mandatory: true },
  { text: "No confirmar pagos sin verificación de una persona del equipo.", category: "payments", mandatory: true },
  { text: "No compartir datos privados de otros clientes ni datos internos de la empresa.", category: "privacy", mandatory: true },
  { text: "No prometer plazos de entrega que no estén confirmados.", category: "delivery", mandatory: false },
  { text: "Respetar los horarios comerciales: fuera de horario, avisar cuándo responde una persona.", category: "hours", mandatory: false },
  { text: "Derivar a una persona las consultas que requieran una decisión o intervención humana.", category: "handoff", mandatory: false },
  { text: "No insistir comercialmente cuando el cliente rechaza una oferta.", category: "sales_conduct", mandatory: false },
];

/** Datos de la empresa que entran a una versión publicada de un bot (copia inmutable). */
export type CompanySnapshot = {
  revision: number;
  name: string;
  profile: CompanyProfile;
  /** reglas NO obligatorias activas al publicar (las obligatorias se leen siempre en vivo) */
  rules: { id: string; text: string; category: RuleCategory }[];
};
export type LiveRule = { id: string; text: string; category: RuleCategory };
