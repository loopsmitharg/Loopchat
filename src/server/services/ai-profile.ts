import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { companyProfileSchema, profileHasContent, resolveCompanyProfile, ruleInputSchema, ruleUpdateSchema, SUGGESTED_RULES, type CompanySnapshot, type LiveRule, type RuleCategory } from "@/lib/ai-profile";
import { resolveBotConfig } from "@/lib/bot-config";
import { db } from "../db";
import { aiPersonalityTemplates, botVersions, bots, tenantAiProfiles, tenantAiRules, tenants } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, forbidden, notFound } from "../http/errors";
import { audit } from "./audit";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export async function tenantHoursSummary(tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const bh = t?.settings?.businessHours;
  return { name: t?.name ?? "", hours: bh?.enabled ? `${(bh.days ?? []).map((d) => DAYS[d]).join(", ")} de ${bh.start} a ${bh.end}` : null };
}

async function loadProfileRow(tenantId: string) {
  return db.query.tenantAiProfiles.findFirst({ where: eq(tenantAiProfiles.tenantId, tenantId) });
}

/** Reglas obligatorias activas: se aplican en vivo a todos los bots (también a versiones ya publicadas). */
export async function liveMandatoryRules(tenantId: string): Promise<LiveRule[]> {
  const rows = await db
    .select({ id: tenantAiRules.id, text: tenantAiRules.text, category: tenantAiRules.category })
    .from(tenantAiRules)
    .where(and(eq(tenantAiRules.tenantId, tenantId), eq(tenantAiRules.enabled, true), eq(tenantAiRules.mandatory, true)))
    .orderBy(asc(tenantAiRules.position), asc(tenantAiRules.createdAt));
  return rows.map((r) => ({ ...r, category: r.category as RuleCategory }));
}

/** Datos de la empresa que se copian a una versión de bot (o se usan en un borrador). */
export async function companySnapshot(tenantId: string): Promise<CompanySnapshot> {
  const row = await loadProfileRow(tenantId);
  const { name } = await tenantHoursSummary(tenantId);
  const rules = await db
    .select({ id: tenantAiRules.id, text: tenantAiRules.text, category: tenantAiRules.category })
    .from(tenantAiRules)
    .where(and(eq(tenantAiRules.tenantId, tenantId), eq(tenantAiRules.enabled, true), eq(tenantAiRules.mandatory, false)))
    .orderBy(asc(tenantAiRules.position), asc(tenantAiRules.createdAt));
  return { revision: row?.revision ?? 0, name, profile: resolveCompanyProfile(row?.profile), rules: rules.map((r) => ({ ...r, category: r.category as RuleCategory })) };
}

/** Una empresa sin perfil ni reglas no cambia nada: se compara como "sin datos de empresa". */
export function snapshotKey(c: CompanySnapshot | null | undefined) {
  if (!c) return null;
  if (!profileHasContent(c.profile) && !c.rules.length) return null;
  return { profile: c.profile, rules: c.rules.map((r) => ({ id: r.id, text: r.text, category: r.category })) };
}

export async function getAiProfile(ctx: Ctx) {
  assertCan(ctx, "bot:read");
  const row = await loadProfileRow(ctx.tenantId);
  const rules = await db.select().from(tenantAiRules).where(eq(tenantAiRules.tenantId, ctx.tenantId)).orderBy(asc(tenantAiRules.position), asc(tenantAiRules.createdAt));
  const company = await tenantHoursSummary(ctx.tenantId);
  const current = await companySnapshot(ctx.tenantId);
  const curKey = JSON.stringify(snapshotKey(current));
  // qué bots heredan cada regla y cuáles tienen publicada una versión anterior de la política
  const botRows = await db.select({ id: bots.id, name: bots.name, role: bots.role, config: bots.config, publishedVersionId: bots.publishedVersionId }).from(bots).where(eq(bots.tenantId, ctx.tenantId)).orderBy(asc(bots.createdAt));
  const vIds = botRows.map((b) => b.publishedVersionId).filter((x): x is string => Boolean(x));
  const vers = vIds.length ? await db.select({ id: botVersions.id, settings: botVersions.settings }).from(botVersions).where(sql`${botVersions.id} in ${vIds}`) : [];
  const inheritance = botRows.map((b) => {
    const disabled = new Set(resolveBotConfig(b.config).behavior.disabledCompanyRules);
    const v = vers.find((x) => x.id === b.publishedVersionId);
    const pubCompany = ((v?.settings ?? null) as { company?: CompanySnapshot } | null)?.company ?? null;
    return {
      id: b.id,
      name: b.name,
      role: b.role,
      published: Boolean(b.publishedVersionId),
      disabledRuleIds: [...disabled],
      outdated: Boolean(b.publishedVersionId) && JSON.stringify(snapshotKey(pubCompany)) !== curKey,
    };
  });
  return {
    profile: resolveCompanyProfile(row?.profile),
    revision: row?.revision ?? 0,
    company,
    rules: rules.map((r) => ({ id: r.id, text: r.text, category: r.category as RuleCategory, enabled: r.enabled, mandatory: r.mandatory, position: r.position })),
    bots: inheritance,
  };
}

export async function updateAiProfile(ctx: Ctx, input: unknown) {
  assertCan(ctx, "bot:write");
  const profile = companyProfileSchema.parse(input);
  const row = await loadProfileRow(ctx.tenantId);
  if (row) await db.update(tenantAiProfiles).set({ profile: profile as unknown as Record<string, unknown>, revision: sql`${tenantAiProfiles.revision} + 1`, updatedBy: actorUserId(ctx), updatedAt: new Date() }).where(eq(tenantAiProfiles.tenantId, ctx.tenantId));
  else await db.insert(tenantAiProfiles).values({ tenantId: ctx.tenantId, profile: profile as unknown as Record<string, unknown>, revision: 1, updatedBy: actorUserId(ctx) }).onConflictDoUpdate({ target: tenantAiProfiles.tenantId, set: { profile: profile as unknown as Record<string, unknown>, revision: sql`${tenantAiProfiles.revision} + 1`, updatedAt: new Date() } });
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_profile.updated", targetType: "tenant", targetId: ctx.tenantId, data: { primaryGoal: profile.objectives.primary } });
  return getAiProfile(ctx);
}

/** Las reglas obligatorias entran en vigor al instante para todos los bots: solo administradores. */
function assertRulePermission(ctx: Ctx, mandatory: boolean) {
  assertCan(ctx, "bot:write");
  if (mandatory) {
    try {
      assertCan(ctx, "settings:write");
    } catch {
      throw forbidden("Solo un administrador puede crear o cambiar reglas obligatorias (se aplican al instante a todos los bots).");
    }
  }
}

export async function createRule(ctx: Ctx, input: z.input<typeof ruleInputSchema>) {
  const d = ruleInputSchema.parse(input);
  assertRulePermission(ctx, d.mandatory);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tenantAiRules).where(eq(tenantAiRules.tenantId, ctx.tenantId));
  if (n >= 60) throw badRequest("Alcanzaste el máximo de 60 reglas generales.");
  const [r] = await db.insert(tenantAiRules).values({ tenantId: ctx.tenantId, ...d, position: n }).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_rule.created", targetType: "ai_rule", targetId: r.id, data: { mandatory: r.mandatory, category: r.category } });
  return r;
}

export async function updateRule(ctx: Ctx, id: string, input: z.input<typeof ruleUpdateSchema>) {
  const d = ruleUpdateSchema.parse(input);
  const cur = await db.query.tenantAiRules.findFirst({ where: and(eq(tenantAiRules.id, id), eq(tenantAiRules.tenantId, ctx.tenantId)) });
  if (!cur) throw notFound();
  assertRulePermission(ctx, cur.mandatory || Boolean(d.mandatory));
  const [r] = await db.update(tenantAiRules).set({ ...d, updatedAt: new Date() }).where(eq(tenantAiRules.id, id)).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_rule.updated", targetType: "ai_rule", targetId: id, data: { ...d, wasMandatory: cur.mandatory } });
  return r;
}

export async function deleteRule(ctx: Ctx, id: string) {
  const cur = await db.query.tenantAiRules.findFirst({ where: and(eq(tenantAiRules.id, id), eq(tenantAiRules.tenantId, ctx.tenantId)) });
  if (!cur) throw notFound();
  assertRulePermission(ctx, cur.mandatory);
  await db.delete(tenantAiRules).where(eq(tenantAiRules.id, id));
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_rule.deleted", targetType: "ai_rule", targetId: id, data: { text: cur.text.slice(0, 80), mandatory: cur.mandatory } });
  return { ok: true };
}

export async function addSuggestedRules(ctx: Ctx) {
  assertRulePermission(ctx, true);
  const existing = new Set((await db.select({ text: tenantAiRules.text }).from(tenantAiRules).where(eq(tenantAiRules.tenantId, ctx.tenantId))).map((r) => r.text));
  let pos = existing.size;
  const add = SUGGESTED_RULES.filter((r) => !existing.has(r.text));
  if (add.length) await db.insert(tenantAiRules).values(add.map((r) => ({ tenantId: ctx.tenantId, text: r.text, category: r.category, mandatory: r.mandatory, enabled: true, position: pos++ })));
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_rule.suggested_added", data: { count: add.length } });
  return { added: add.length };
}

/* ------------------------- plantillas propias ------------------------- */

export const templateInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(""),
  personality: z.record(z.string(), z.unknown()),
  behavior: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function listTemplates(ctx: Ctx) {
  assertCan(ctx, "bot:read");
  return db.select().from(aiPersonalityTemplates).where(eq(aiPersonalityTemplates.tenantId, ctx.tenantId)).orderBy(asc(aiPersonalityTemplates.createdAt));
}

export async function createTemplate(ctx: Ctx, input: z.input<typeof templateInputSchema>) {
  assertCan(ctx, "bot:write");
  const d = templateInputSchema.parse(input);
  // solo se guardan campos válidos de personalidad/comportamiento
  const cfg = resolveBotConfig({ personality: d.personality, behavior: d.behavior ?? {} });
  const { welcomeMessage: _w, ...personality } = cfg.personality;
  void _w;
  const behavior = { do: cfg.behavior.do, dont: cfg.behavior.dont, handoffWhen: cfg.behavior.handoffWhen };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(aiPersonalityTemplates).where(eq(aiPersonalityTemplates.tenantId, ctx.tenantId));
  if (n >= 30) throw badRequest("Alcanzaste el máximo de 30 plantillas propias.");
  const [t] = await db.insert(aiPersonalityTemplates).values({ tenantId: ctx.tenantId, name: d.name, description: d.description, personality, behavior }).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_template.created", targetType: "ai_template", targetId: t.id });
  return t;
}

export async function deleteTemplate(ctx: Ctx, id: string) {
  assertCan(ctx, "bot:write");
  const res = await db.delete(aiPersonalityTemplates).where(and(eq(aiPersonalityTemplates.id, id), eq(aiPersonalityTemplates.tenantId, ctx.tenantId))).returning({ id: aiPersonalityTemplates.id });
  if (!res.length) throw notFound();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_template.deleted", targetType: "ai_template", targetId: id });
  return { ok: true };
}
