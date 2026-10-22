import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { resolveBotConfig } from "@/lib/bot-config";
import { INSTRUCTIONS_VERSION } from "@/lib/instructions/build";
import { db } from "../db";
import { botTeamMembers, botTeams, botVersions, bots, tenantAiRules } from "../db/schema";
import { assertCan, type Ctx } from "../authz/context";
import { notFound } from "../http/errors";
import { buildPrompt } from "../flows/ai-step";
import { pipelineScope } from "../flows/pipeline-scope";
import { draftSettings, effectiveTools, settingsFromVersion, type BotSettings, type VersionSnapshot } from "../flows/settings";
import { loadTeamVersion } from "../teams/orchestrator";
import { liveMandatoryRules, tenantHoursSummary } from "./ai-profile";

async function settingsFor(ctx: Ctx, botId: string, source: string): Promise<{ bot: typeof bots.$inferSelect; settings: BotSettings; label: string }> {
  const bot = await db.query.bots.findFirst({ where: and(eq(bots.id, botId), eq(bots.tenantId, ctx.tenantId)) });
  if (!bot) throw notFound();
  if (source === "draft") return { bot, settings: await draftSettings(bot), label: "Borrador" };
  const vid = source === "published" ? bot.publishedVersionId : source;
  if (!vid) return { bot, settings: await draftSettings(bot), label: "Borrador (sin versión publicada)" };
  const v = await db.query.botVersions.findFirst({ where: and(eq(botVersions.id, vid), eq(botVersions.botId, botId), eq(botVersions.tenantId, ctx.tenantId)) });
  if (!v) throw notFound("Versión inexistente.");
  return { bot, settings: settingsFromVersion(bot, v.settings), label: `v${v.version}` };
}

/** Equipo activo (o el primero) del que forma parte el bot, para la sección de coordinación. */
async function teamFor(tenantId: string, botId: string) {
  const rows = await db.select({ teamId: botTeamMembers.teamId, status: botTeams.status, name: botTeams.name, versionId: botTeams.publishedVersionId }).from(botTeamMembers).innerJoin(botTeams, eq(botTeams.id, botTeamMembers.teamId)).where(and(eq(botTeamMembers.tenantId, tenantId), eq(botTeamMembers.botId, botId)));
  const t = rows.find((r) => r.status === "active") ?? rows[0];
  if (!t?.versionId) return null;
  const tv = await loadTeamVersion(tenantId, t.versionId);
  if (!tv) return null;
  return { name: t.name, members: [...tv.bots.values()].map((b) => ({ name: b.bot.name, role: b.settings.role, self: b.bot.id === botId })) };
}

/**
 * "Ver instrucciones efectivas": el mismo armado que usa el runtime, con los datos de la
 * conversación reemplazados por una descripción. No incluye claves ni datos de clientes.
 */
export async function getEffectiveInstructions(ctx: Ctx, botId: string, source = "draft") {
  assertCan(ctx, "bot:read");
  const { bot, settings, label } = await settingsFor(ctx, botId, source);
  const cfg = settings.config;
  const tools = effectiveTools(settings, settings.allowedTools);
  const scope = await pipelineScope(ctx.tenantId, cfg, null);
  const mandatory = await liveMandatoryRules(ctx.tenantId);
  const disabled = new Set(cfg.behavior.disabledCompanyRules);
  const hours = settings.company ? (await tenantHoursSummary(ctx.tenantId)).hours : null;
  const team = await teamFor(ctx.tenantId, bot.id);
  const built = buildPrompt({
    botInstructions: settings.instructions,
    tools,
    knowledge: [],
    stageNames: tools.includes("create_opportunity") || tools.includes("update_stage") ? scope.allowed.map((s) => s.name) : [],
    config: cfg,
    role: settings.role,
    botName: bot.name,
    company: settings.company ? { name: settings.company.name, profile: settings.company.profile, rules: settings.company.rules.filter((r) => !disabled.has(r.id)), hoursSummary: hours } : null,
    mandatoryRules: mandatory,
    team,
    catalog: null,
    memory: cfg.memory.enabled ? "[resumen del cliente en el CRM, si existe]" : null,
    fields: [],
    trackResolution: cfg.hours.maxUnresolvedAttempts > 0,
    opportunityPolicy: cfg.pipeline.createOpportunity === "any_inquiry" ? "any_inquiry" : "purchase_intent",
    quoteEnabled: Boolean(scope.quoteStage),
    preview: true,
  });
  const allRules = await db.select().from(tenantAiRules).where(eq(tenantAiRules.tenantId, ctx.tenantId)).orderBy(asc(tenantAiRules.position));
  const snapIds = new Set((settings.company?.rules ?? []).map((r) => r.id));
  return {
    label,
    version: INSTRUCTIONS_VERSION,
    hash: built.hash,
    sections: built.policy.sections.map((s) => ({ level: s.level, key: s.key, title: s.title, text: s.lines.join("\n") })),
    data: built.dataTitles,
    notes: built.policy.notes,
    tools,
    system: built.system,
    companyIncluded: Boolean(settings.company),
    rules: allRules.map((r) => ({
      id: r.id,
      text: r.text,
      category: r.category,
      mandatory: r.mandatory,
      enabled: r.enabled,
      // obligatorias: siempre en vivo; las demás: según la copia de la versión y lo desactivado en el bot
      applied: r.enabled && (r.mandatory || (snapIds.has(r.id) && !disabled.has(r.id))),
      disabledByBot: !r.mandatory && disabled.has(r.id),
      pendingPublish: !r.mandatory && r.enabled && !snapIds.has(r.id),
    })),
  };
}

/* ----------------------------- comparación ----------------------------- */

const SECTION_LABEL: Record<string, string> = {
  handoff: "Derivación humana",
  control: "Control humano",
  personality: "Personalidad",
  hours: "Horarios y reglas",
  tools: "Herramientas",
  catalog: "Catálogo",
  memory: "Memoria",
  objectives: "Datos comerciales",
  pipeline: "Pipeline asociado",
  identity: "Identidad y objetivos",
  behavior: "Reglas de comportamiento",
  knowledge: "Conocimiento",
  operation: "Operación",
};
const TOP_LABEL: Record<string, string> = { instructions: "Instrucciones personalizadas", role: "Rol", allowedTools: "Herramientas habilitadas", handoffKeywords: "Palabras de derivación", aiConnectionId: "Conexión de IA", model: "Modelo", productIds: "Productos asociados", company: "Política de la empresa" };

function flat(obj: unknown, prefix: string, out: Record<string, unknown>) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = obj;
}

function snapshotFlat(s: BotSettings) {
  const out: Record<string, unknown> = {};
  const { config, company, ...top } = s;
  for (const [k, v] of Object.entries(top)) out[k] = Array.isArray(v) ? [...v].sort() : v;
  flat(resolveBotConfig(config), "config", out);
  out.company = company ? `revisión ${company.revision} · ${company.rules.length} política(s)` : "sin política de la empresa";
  return out;
}

function labelOf(path: string) {
  if (path.startsWith("config.")) {
    const [, section, ...rest] = path.split(".");
    return `${SECTION_LABEL[section] ?? section}: ${rest.join(".")}`;
  }
  return TOP_LABEL[path] ?? path;
}

/** Qué cambió entre dos versiones (o una versión y el borrador). */
export async function compareVersions(ctx: Ctx, botId: string, a: string, b: string) {
  assertCan(ctx, "bot:read");
  const A = await settingsFor(ctx, botId, a);
  const B = await settingsFor(ctx, botId, b);
  const fa = snapshotFlat(A.settings);
  const fb = snapshotFlat(B.settings);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  const changes = keys
    .filter((k) => JSON.stringify(fa[k] ?? null) !== JSON.stringify(fb[k] ?? null))
    .map((k) => ({ path: k, label: labelOf(k), before: fa[k] ?? null, after: fb[k] ?? null }));
  return { a: A.label, b: B.label, changes };
}

export type { VersionSnapshot };
