import { z } from "zod";
import { ADDRESS, EMOJI_LEVELS, FORMALITY, LENGTHS } from "./ai-profile";

export const ATTITUDES = ["serious", "friendly", "enthusiastic", "calm", "empathetic", "persuasive", "technical"] as const;
export const INITIATIVE = ["reactive", "consultive", "proactive"] as const;
export const SALES_INTENSITY = ["none", "consultive", "moderate", "sales", "intensive"] as const;
export const STYLES = ["direct", "conversational", "explanatory", "technical", "persuasive", "empathetic"] as const;
export const AI_HANDOFF_CONDITIONS = ["complex_complaint", "out_of_scope", "needs_authorization"] as const;
export const BOT_METRICS = ["handled", "resolved", "opportunities", "qualified", "transfers", "handoffs", "resolution_time", "verified_actions", "ai_usage"] as const;

/**
 * Configuración extendida de un chatbot (columna bots.config, copiada a bot_versions.settings
 * al publicar). Todos los campos tienen valores por defecto: un bot sin configuración se
 * comporta como antes, salvo la detección de insultos, que viene activada.
 * Se usa en servidor (validación + runtime) y en cliente (formularios).
 */
const terms = z.array(z.string().trim().min(2).max(40)).max(100);

export const handoffConfigSchema = z.object({
  /** Derivar sin llamar a la IA ante insultos o agresiones verbales (detección local). */
  insultDetection: z.boolean().default(true),
  /** Términos extra a considerar ofensivos (además de los diccionarios incluidos). */
  extraInsultTerms: terms.default([]),
  /** Términos a ignorar (p. ej. nombres de productos o jerga propia del rubro). */
  ignoredInsultTerms: terms.default([]),
  /** La IA puede decidir derivar (cliente molesto, consulta fuera de alcance). */
  allowAiHandoff: z.boolean().default(true),
  /** Mensaje fijo (sin IA) que se envía al derivar. Vacío = no se envía nada. */
  transferMessage: z.string().trim().max(500).default(""),
  /** Responsable al que se asigna la conversación derivada (null = queda sin asignar). */
  assignToUserId: z.string().trim().min(1).max(100).nullable().default(null),
  /** Crear una tarea para que el equipo atienda la conversación derivada. */
  notifyTeam: z.boolean().default(true),
});

export const controlConfigSchema = z.object({
  /** Reactivación automática del bot: solo por regla explícita. */
  autoResume: z.enum(["never", "on_resolve"]).default("never"),
});

export const personalityConfigSchema = z.object({
  /** Tono heredado (versiones anteriores): se usa si no se eligió una formalidad. */
  tone: z.enum(["formal", "professional", "informal", "custom"]).default("professional"),
  customTone: z.string().trim().max(300).default(""),
  length: z.enum(LENGTHS).default("short"),
  emojis: z.enum(EMOJI_LEVELS).default("few"),
  language: z.enum(["es", "en", "pt"]).default("es"),
  matchCustomerLanguage: z.boolean().default(true),
  /** Mensaje fijo de bienvenida/presentación al primer contacto (vacío = sin bienvenida). */
  welcomeMessage: z.string().trim().max(500).default(""),
  /** null en las dimensiones nuevas = no se define (comportamiento anterior o el de la marca). */
  formality: z.enum(FORMALITY).nullable().default(null),
  attitudes: z.array(z.enum(ATTITUDES)).max(3).default([]),
  attitudeNote: z.string().trim().max(200).default(""),
  initiative: z.enum(INITIATIVE).nullable().default(null),
  salesIntensity: z.enum(SALES_INTENSITY).nullable().default(null),
  style: z.enum(STYLES).nullable().default(null),
  address: z.enum(ADDRESS).nullable().default(null),
  useCustomerName: z.enum(["auto", "always", "never"]).default("auto"),
  questionStyle: z.enum(["auto", "one_at_a_time"]).default("auto"),
  preferredTerms: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  forbiddenTerms: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  glossary: z.string().trim().max(600).default(""),
  /** Toma como base la personalidad de la marca (Configuración → Identidad y objetivos de IA). */
  inheritBrand: z.boolean().default(true),
});

export const hoursConfigSchema = z.object({
  /** Fuera del horario de atención de la empresa (Configuración → Empresa). */
  outOfHours: z.enum(["respond", "message_and_continue", "message_and_handoff"]).default("respond"),
  /** Vacío = usa el mensaje fuera de horario de la empresa. */
  outOfHoursMessage: z.string().trim().max(500).default(""),
  /** Consultas seguidas que el bot no pudo resolver antes de derivar (0 = sin límite). */
  maxUnresolvedAttempts: z.number().int().min(0).max(10).default(3),
});

export const toolsConfigSchema = z.object({
  /** Etapas a las que la IA puede mover oportunidades (vacío = todas las etapas abiertas). Nunca ganada/perdida. */
  allowedStageIds: z.array(z.string().uuid()).max(100).default([]),
  taskAssignee: z.enum(["conversation", "user", "none"]).default("conversation"),
  taskAssigneeUserId: z.string().trim().min(1).max(100).nullable().default(null),
  taskDefaultDueHours: z.number().int().min(1).max(720).default(24),
  taskMaxDueHours: z.number().int().min(1).max(2160).default(168),
});

export const catalogConfigSchema = z.object({
  /** selected = solo productos asociados a este bot; all = todo el catálogo activo de la empresa. */
  mode: z.enum(["selected", "all"]).default("selected"),
  /** Permitir que el bot envíe la foto de un producto por WhatsApp. */
  sendPhotos: z.boolean().default(true),
});

export const memoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export const objectivesConfigSchema = z.object({
  fields: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), required: z.boolean().default(false) }))
    .max(20)
    .default([]),
});

export const pipelineConfigSchema = z.object({
  /** Pipeline principal del bot (null = pipeline principal de la empresa). */
  primaryPipelineId: z.string().uuid().nullable().default(null),
  /** Pipelines adicionales que puede consultar y usar. */
  extraPipelineIds: z.array(z.string().uuid()).max(10).default([]),
  /** Etapa en la que crea oportunidades (null = primera etapa abierta del pipeline principal). */
  initialStageId: z.string().uuid().nullable().default(null),
  /** Cuándo puede crear una oportunidad. */
  createOpportunity: z.enum(["purchase_intent", "any_inquiry", "never"]).default("purchase_intent"),
  /** Cómo puede mover etapas (siempre dentro de sus etapas permitidas; nunca ganada/perdida). */
  stageMoves: z.enum(["allowed_any", "forward_only"]).default("allowed_any"),
  /** Etapa a la que pasa la oportunidad cuando el cliente pide una cotización/presupuesto. */
  quoteStageId: z.string().uuid().nullable().default(null),
  /** Responsable humano por defecto de las oportunidades que crea. */
  defaultOwnerUserId: z.string().trim().min(1).max(100).nullable().default(null),
  /** Al recibir una conversación derivada por otro bot. */
  onTransferAssignOwner: z.boolean().default(false),
  onTransferEnsureOpportunity: z.boolean().default(false),
});

export const identityConfigSchema = z.object({
  /** Nombre que el bot usa para presentarse (solo si showName). */
  displayName: z.string().trim().max(60).default(""),
  showName: z.boolean().default(false),
  description: z.string().trim().max(400).default(""),
  specialization: z.string().trim().max(200).default(""),
  /** Objetivos del catálogo de su rol (ver BOT_GOALS). El primero es el principal. */
  goals: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(10).default([]),
  customGoals: z.array(z.string().trim().min(3).max(200)).max(10).default([]),
  /** Indicadores que la empresa quiere seguir para este bot (no son instrucciones al modelo). */
  metrics: z.array(z.enum(BOT_METRICS)).max(9).default([]),
});

const rule = z.string().trim().min(3).max(200);
export const behaviorConfigSchema = z.object({
  do: z.array(rule).max(20).default([]),
  dont: z.array(rule).max(20).default([]),
  /** Condiciones de derivación evaluadas por la IA (las determinísticas viven en handoff/hours/operation). */
  handoffWhen: z.array(z.enum(AI_HANDOFF_CONDITIONS)).max(10).default([]),
  customHandoff: z.array(rule).max(10).default([]),
  /** Oportunidad de alto valor: deriva sin depender de la IA cuando el importe la supera (null = no). */
  highValueAmount: z.number().min(0).max(1e10).nullable().default(null),
  /** Falla al ejecutar una acción (oportunidad, tarea): derivar en lugar de reintentar todo el turno. */
  handoffOnToolError: z.boolean().default(false),
  /** Reglas NO obligatorias de la empresa que este bot no hereda. */
  disabledCompanyRules: z.array(z.string().uuid()).max(100).default([]),
});

export const knowledgeConfigSchema = z.object({
  /** all = todo el conocimiento de la empresa; selected = solo las fuentes elegidas. */
  mode: z.enum(["all", "selected"]).default("all"),
  sourceIds: z.array(z.string().uuid()).max(200).default([]),
});

export const operationConfigSchema = z.object({
  /** null = valor por defecto del proveedor. Solo se envía si el modelo lo admite. */
  temperature: z.number().min(0).max(1).nullable().default(null),
  maxResponseTokens: z.number().int().min(100).max(2000).nullable().default(null),
  /** Reintentos ante fallas transitorias del proveedor (luego deriva a una persona). */
  retries: z.number().int().min(1).max(3).default(3),
  onFailure: z.enum(["handoff", "message_and_handoff"]).default("handoff"),
  failureMessage: z.string().trim().max(300).default(""),
  /** Llamadas a la IA por conversación antes de derivar (0 = sin límite). */
  maxAiCallsPerConversation: z.number().int().min(0).max(500).default(0),
});

export const botConfigSchema = z.object({
  handoff: handoffConfigSchema.prefault({}),
  control: controlConfigSchema.prefault({}),
  personality: personalityConfigSchema.prefault({}),
  hours: hoursConfigSchema.prefault({}),
  tools: toolsConfigSchema.prefault({}),
  catalog: catalogConfigSchema.prefault({}),
  memory: memoryConfigSchema.prefault({}),
  objectives: objectivesConfigSchema.prefault({}),
  pipeline: pipelineConfigSchema.prefault({}),
  identity: identityConfigSchema.prefault({}),
  behavior: behaviorConfigSchema.prefault({}),
  knowledge: knowledgeConfigSchema.prefault({}),
  operation: operationConfigSchema.prefault({}),
});

export type BotConfig = z.output<typeof botConfigSchema>;
export type BotConfigInput = z.input<typeof botConfigSchema>;
export const BOT_CONFIG_SECTIONS = ["handoff", "control", "personality", "hours", "tools", "catalog", "memory", "objectives", "pipeline", "identity", "behavior", "knowledge", "operation"] as const;
export type BotConfigSection = (typeof BOT_CONFIG_SECTIONS)[number];

/** Esquema de sección sin valores por defecto: en un parche, un campo ausente NO se modifica. */
function patchOf<T extends z.ZodRawShape>(obj: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(obj.shape)) shape[k] = (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional();
  return z.object(shape).strict();
}

const SECTION_SCHEMAS = {
  handoff: handoffConfigSchema,
  control: controlConfigSchema,
  personality: personalityConfigSchema,
  hours: hoursConfigSchema,
  tools: toolsConfigSchema,
  catalog: catalogConfigSchema,
  memory: memoryConfigSchema,
  objectives: objectivesConfigSchema,
  pipeline: pipelineConfigSchema,
  identity: identityConfigSchema,
  behavior: behaviorConfigSchema,
  knowledge: knowledgeConfigSchema,
  operation: operationConfigSchema,
} as const;

export type BotConfigPatch = { [K in BotConfigSection]?: Partial<z.input<(typeof SECTION_SCHEMAS)[K]>> };

/** Parche parcial por sección (cada sección se valida completa al fusionarse). */
export const botConfigPatchSchema = z
  .object(Object.fromEntries(BOT_CONFIG_SECTIONS.map((k) => [k, patchOf(SECTION_SCHEMAS[k] as z.ZodObject<z.ZodRawShape>).optional()])))
  .strict() as unknown as z.ZodType<BotConfigPatch, BotConfigPatch>;

/** Normaliza cualquier valor guardado (o vacío) a una configuración completa y válida. */
export function resolveBotConfig(raw: unknown): BotConfig {
  const r = botConfigSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  // configuración corrupta o de una versión vieja: se recupera sección por sección
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of BOT_CONFIG_SECTIONS) {
    const s = botConfigSchema.shape[k].safeParse(obj[k] ?? {});
    out[k] = s.success ? s.data : botConfigSchema.shape[k].parse({});
  }
  return out as BotConfig;
}

/** Fusiona un parche sobre la configuración actual y valida el resultado. */
export function mergeBotConfig(current: unknown, patch: BotConfigPatch): BotConfig {
  const base = resolveBotConfig(current);
  const merged: Record<string, unknown> = { ...base };
  for (const k of BOT_CONFIG_SECTIONS) {
    const p = patch[k];
    if (p) merged[k] = { ...base[k], ...p };
  }
  return botConfigSchema.parse(merged);
}
