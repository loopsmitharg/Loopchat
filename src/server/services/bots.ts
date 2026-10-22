import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AI_TOOLS, type AiTool, type FlowGraph } from "@/lib/flow/types";
import { botConfigPatchSchema, mergeBotConfig, resolveBotConfig } from "@/lib/bot-config";
import { validateGraph } from "@/lib/flow/validate";
import { db } from "../db";
import { BOT_ROLES, aiProviderConnections, botProducts, knowledgeSources, pipelines, tenantAiRules, botVersions, bots, channelConnections, flowRunSteps, flowRuns, products, stages } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import { compileInstructionsBot } from "../flows/compile";
import { assignableMembers, draftSettings, type VersionSnapshot } from "../flows/settings";
import { INSTRUCTIONS_VERSION } from "@/lib/instructions/build";
import { companySnapshot, snapshotKey } from "./ai-profile";
import { audit } from "./audit";
import { assertResourceQuota, getPlanState } from "./usage";

export const botInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  role: z.enum(BOT_ROLES).default("custom"),
  mode: z.enum(["instructions", "flow"]).default("instructions"),
  aiConnectionId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(100).regex(/^[\w.\-:/@]*$/).nullable().optional(),
  instructions: z.string().max(8000).default(""),
  allowedTools: z.array(z.enum(AI_TOOLS)).default(["classify", "use_knowledge", "handoff", "create_opportunity"]),
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(20).default(["humano", "asesor", "persona"]),
  channelConnectionId: z.string().uuid().nullable().optional(),
  config: botConfigPatchSchema.optional(),
});

/** Valida referencias de la configuración: personas de la empresa (no "solo lectura") y etapas propias. */
async function assertConfigRefs(ctx: Ctx, config: ReturnType<typeof resolveBotConfig>) {
  const users = [config.handoff.assignToUserId, config.tools.taskAssignee === "user" ? config.tools.taskAssigneeUserId : null].filter((x): x is string => Boolean(x));
  const ok = await assignableMembers(ctx.tenantId, users);
  for (const u of users) if (!ok.has(u)) throw badRequest("El responsable elegido no es un miembro activo que pueda atender conversaciones.");
  if (config.tools.taskAssignee === "user" && !config.tools.taskAssigneeUserId) throw badRequest("Elegí la persona responsable de las tareas.");
  if (config.tools.allowedStageIds.length) {
    const rows = await db.select({ id: stages.id, kind: stages.kind }).from(stages).where(and(eq(stages.tenantId, ctx.tenantId), sql`${stages.id} in ${config.tools.allowedStageIds}`));
    if (rows.length !== new Set(config.tools.allowedStageIds).size) throw badRequest("Alguna etapa no existe en tu pipeline.");
    if (rows.some((r) => r.kind !== "open")) throw badRequest("El bot no puede mover oportunidades a etapas de cierre (ganada/perdida).");
  }
  if (config.tools.taskDefaultDueHours > config.tools.taskMaxDueHours) throw badRequest("El vencimiento por defecto no puede superar el máximo.");
  // pipeline asociado: pipelines propios; etapas dentro de los pipelines autorizados y abiertas
  const pc = config.pipeline;
  const pIds = [pc.primaryPipelineId, ...pc.extraPipelineIds].filter((x): x is string => Boolean(x));
  const ownP = await db.select({ id: pipelines.id, isDefault: pipelines.isDefault }).from(pipelines).where(eq(pipelines.tenantId, ctx.tenantId));
  if (pIds.some((p) => !ownP.some((o) => o.id === p))) throw badRequest("Algún pipeline elegido no existe en tu empresa.");
  const scope = new Set(pIds.length ? pIds : ownP.filter((p) => p.isDefault).map((p) => p.id));
  if (!pc.primaryPipelineId && pc.extraPipelineIds.length) for (const p of ownP.filter((o) => o.isDefault)) scope.add(p.id);
  const stageRefs = [pc.initialStageId, pc.quoteStageId, ...config.tools.allowedStageIds].filter((x): x is string => Boolean(x));
  if (stageRefs.length) {
    const rows = await db.select({ id: stages.id, kind: stages.kind, pipelineId: stages.pipelineId }).from(stages).where(and(eq(stages.tenantId, ctx.tenantId), sql`${stages.id} in ${stageRefs}`));
    for (const id of stageRefs) {
      const r = rows.find((x) => x.id === id);
      if (!r) throw badRequest("Alguna etapa elegida no existe.");
      if (r.kind !== "open") throw badRequest("El bot no puede usar etapas de cierre (ganada/perdida).");
      if (!scope.has(r.pipelineId)) throw badRequest("Las etapas elegidas deben pertenecer a los pipelines del bot.");
    }
  }
  if (pc.defaultOwnerUserId && !(await assignableMembers(ctx.tenantId, [pc.defaultOwnerUserId])).has(pc.defaultOwnerUserId)) throw badRequest("El responsable por defecto no es un miembro activo que pueda atender.");
  // conocimiento autorizado: fuentes de la empresa
  if (config.knowledge.sourceIds.length) {
    const rows = await db.select({ id: knowledgeSources.id }).from(knowledgeSources).where(and(eq(knowledgeSources.tenantId, ctx.tenantId), sql`${knowledgeSources.id} in ${config.knowledge.sourceIds}`));
    if (rows.length !== new Set(config.knowledge.sourceIds).size) throw badRequest("Alguna fuente de conocimiento no existe en tu empresa.");
  }
  // reglas de la empresa: un bot nunca puede desactivar una regla obligatoria
  if (config.behavior.disabledCompanyRules.length) {
    const rows = await db.select({ id: tenantAiRules.id, mandatory: tenantAiRules.mandatory }).from(tenantAiRules).where(and(eq(tenantAiRules.tenantId, ctx.tenantId), sql`${tenantAiRules.id} in ${config.behavior.disabledCompanyRules}`));
    if (rows.length !== new Set(config.behavior.disabledCompanyRules).size) throw badRequest("Alguna regla de la empresa no existe.");
    if (rows.some((r) => r.mandatory)) throw badRequest("Las reglas obligatorias de la empresa no se pueden desactivar en un bot.");
  }
}

/** Recepcionista: nunca crea ni mueve oportunidades (también se valida en el runtime). */
function toolsForRole(role: string, tools: AiTool[]) {
  return role === "receptionist" ? tools.filter((t) => t !== "create_opportunity" && t !== "update_stage") : tools;
}

/** Parche de configuración: sin valores por defecto (un campo ausente NO se modifica). */
export const botUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  role: z.enum(BOT_ROLES).optional(),
  aiConnectionId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(100).regex(/^[\w.\-:/@]*$/).nullable().optional(),
  instructions: z.string().max(8000).optional(),
  allowedTools: z.array(z.enum(AI_TOOLS)).optional(),
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(20).optional(),
  channelConnectionId: z.string().uuid().nullable().optional(),
  config: botConfigPatchSchema.optional(),
});

async function assertRefs(ctx: Ctx, data: { aiConnectionId?: string | null; channelConnectionId?: string | null }) {
  if (data.aiConnectionId) {
    const c = await db.query.aiProviderConnections.findFirst({ where: and(eq(aiProviderConnections.id, data.aiConnectionId), eq(aiProviderConnections.tenantId, ctx.tenantId)) });
    if (!c || c.status === "revoked") throw badRequest("Conexión de IA inexistente o revocada.");
  }
  if (data.channelConnectionId) {
    const c = await db.query.channelConnections.findFirst({ where: and(eq(channelConnections.id, data.channelConnectionId), eq(channelConnections.tenantId, ctx.tenantId)) });
    if (!c) throw badRequest("Número de WhatsApp inexistente.");
  }
}

export async function listBots(ctx: Ctx) {
  assertCan(ctx, "bot:read");
  return db
    .select({
      id: bots.id,
      name: bots.name,
      role: bots.role,
      mode: bots.mode,
      pipelineId: sql<string | null>`${bots.config}->'pipeline'->>'primaryPipelineId'`,
      status: bots.status,
      model: bots.model,
      aiConnectionId: bots.aiConnectionId,
      publishedVersionId: bots.publishedVersionId,
      updatedAt: bots.updatedAt,
      publishedVersion: sql<number | null>`(select v.version from ${botVersions} v where v.id = "bots"."published_version_id")`,
      runs7d: sql<number>`(select count(*)::int from ${flowRuns} r where r.bot_id = "bots"."id" and r.started_at > now() - interval '7 days')`,
      handoffs7d: sql<number>`(select count(*)::int from ${flowRuns} r where r.bot_id = "bots"."id" and r.status = 'handed_off' and r.started_at > now() - interval '7 days')`,
    })
    .from(bots)
    .where(eq(bots.tenantId, ctx.tenantId))
    .orderBy(asc(bots.createdAt));
}

export async function getBot(ctx: Ctx, id: string) {
  assertCan(ctx, "bot:read");
  const b = await db.query.bots.findFirst({ where: and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)) });
  if (!b) throw notFound();
  const versions = await db
    .select({ id: botVersions.id, version: botVersions.version, publishedAt: botVersions.publishedAt, checksum: botVersions.checksum, hasSettings: sql<boolean>`${botVersions.settings} is not null` })
    .from(botVersions)
    .where(eq(botVersions.botId, id))
    .orderBy(desc(botVersions.version))
    .limit(20);
  const published = b.publishedVersionId ? await db.query.botVersions.findFirst({ where: eq(botVersions.id, b.publishedVersionId) }) : null;
  const draft = await draftSettings(b);
  // ¿hay cambios guardados sin publicar? (comparación de la copia publicada con el borrador)
  const pending = published?.settings ? snapshotChecksum(snapshotOf(draft), b.mode === "flow" ? b.draftGraph : null) !== snapshotChecksum(published.settings as VersionSnapshot, b.mode === "flow" ? published.graph : null) : false;
  return { bot: { ...b, config: draft.config, productIds: draft.productIds }, versions, publishedGraph: published?.graph ?? null, unpublishedChanges: pending };
}

export async function createBot(ctx: Ctx, input: z.input<typeof botInputSchema>) {
  assertCan(ctx, "bot:write");
  const data = botInputSchema.parse(input);
  await assertRefs(ctx, data);
  if (data.config) await assertConfigRefs(ctx, mergeBotConfig({}, data.config));
  if (data.mode === "flow") {
    const plan = await getPlanState(ctx.tenantId);
    if (plan.limits.editor !== "full") throw badRequest("Tu plan incluye el editor básico: creá un bot por instrucciones o pedí el cambio de plan.");
  }
  const draft: FlowGraph | null =
    data.mode === "flow"
      ? {
          nodes: [
            { id: "start", type: "start", position: { x: 80, y: 40 }, data: {} },
            { id: "end", type: "end", position: { x: 80, y: 260 }, data: {} },
          ],
          edges: [{ id: "e1", source: "start", target: "end", sourceHandle: "out" }],
        }
      : null;
  const [b] = await db
    .insert(bots)
    .values({
      tenantId: ctx.tenantId,
      name: data.name,
      role: data.role,
      mode: data.mode,
      aiConnectionId: data.aiConnectionId ?? null,
      model: data.model || null,
      instructions: data.instructions,
      allowedTools: toolsForRole(data.role, data.allowedTools),
      handoffKeywords: data.handoffKeywords,
      channelConnectionId: data.channelConnectionId ?? null,
      draftGraph: draft,
      config: data.config ? (mergeBotConfig({}, data.config) as unknown as Record<string, unknown>) : undefined,
    })
    .returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "bot.created", targetType: "bot", targetId: b.id });
  return b;
}

export async function updateBotSettings(ctx: Ctx, id: string, input: z.input<typeof botUpdateSchema>) {
  assertCan(ctx, "bot:write");
  const { config: configPatch, ...data } = botUpdateSchema.parse(input);
  await assertRefs(ctx, data);
  const current = await db.query.bots.findFirst({ where: and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)) });
  if (!current) throw notFound();
  const set: Partial<typeof bots.$inferInsert> = { ...data, model: data.model === "" ? null : data.model, updatedAt: new Date() };
  const role = data.role ?? current.role;
  if (role === "receptionist") set.allowedTools = toolsForRole(role, (data.allowedTools ?? current.allowedTools) as AiTool[]);
  if (configPatch) {
    const merged = mergeBotConfig(current.config, configPatch);
    await assertConfigRefs(ctx, merged);
    set.config = merged as unknown as Record<string, unknown>;
  }
  const res = await db
    .update(bots)
    .set(set)
    .where(and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)))
    .returning();
  if (res.length === 0) throw notFound();
  if (configPatch) await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "bot.config_updated", targetType: "bot", targetId: id, data: { sections: Object.keys(configPatch) } });
  return { ...res[0], config: resolveBotConfig(res[0].config) };
}

/** Guarda el borrador del grafo (autoguardado) con control de revisión optimista. */
export async function saveDraft(ctx: Ctx, id: string, input: { graph: unknown; revision: number }) {
  assertCan(ctx, "bot:write");
  const graph = input.graph as FlowGraph;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw badRequest("Grafo inválido.");
  if (JSON.stringify(graph).length > 300_000) throw badRequest("El flujo es demasiado grande.");
  const res = await db
    .update(bots)
    .set({ draftGraph: graph, draftRevision: sql`${bots.draftRevision} + 1`, updatedAt: new Date() })
    .where(and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId), eq(bots.draftRevision, input.revision)))
    .returning({ draftRevision: bots.draftRevision });
  if (res.length === 0) {
    const exists = await db.query.bots.findFirst({ where: and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)) });
    if (!exists) throw notFound();
    throw conflict("El borrador fue modificado en otra pestaña o por otra persona. Recargá para ver la última versión.", { revision: exists.draftRevision });
  }
  return { revision: res[0].draftRevision };
}

async function stageIdsForTenant(tenantId: string) {
  const rows = await db.select({ id: stages.id }).from(stages).where(eq(stages.tenantId, tenantId));
  return new Set(rows.map((r) => r.id));
}

export async function graphForPublish(ctx: Ctx, bot: typeof bots.$inferSelect): Promise<FlowGraph> {
  if (bot.mode === "instructions") return compileInstructionsBot({ tools: bot.allowedTools as AiTool[], handoffKeywords: bot.handoffKeywords });
  return bot.draftGraph as FlowGraph;
}

/** Publica una versión inmutable (atómica). El runtime solo ejecuta versiones publicadas. */
export async function publishBot(ctx: Ctx, id: string) {
  assertCan(ctx, "bot:publish");
  const bot = await db.query.bots.findFirst({ where: and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)) });
  if (!bot) throw notFound();
  const graph = await graphForPublish(ctx, bot);
  const issues = validateGraph(graph, { stageIds: await stageIdsForTenant(ctx.tenantId) });
  if (issues.length) throw badRequest("El flujo tiene errores. Corregilos antes de publicar.", { issues });
  const usesAi = graph.nodes.some((n) => n.type === "ai");
  if (usesAi && !bot.aiConnectionId) throw badRequest("El flujo usa IA: elegí un proveedor de IA en la configuración del bot.");
  const draft = await draftSettings(bot);
  // productos archivados o de otra empresa nunca entran en la versión
  const liveProducts = draft.productIds.length ? (await db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, ctx.tenantId), sql`${products.id} in ${draft.productIds}`, sql`${products.archivedAt} is null`))).map((r) => r.id) : [];
  const snapshot = snapshotOf({ ...draft, productIds: liveProducts });
  const json = JSON.stringify(graph);
  const checksum = snapshotChecksum(snapshot, graph);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from bots where id = ${bot.id} for update`);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${botVersions.version}), 0)::int` }).from(botVersions).where(eq(botVersions.botId, bot.id));
    const [v] = await tx.insert(botVersions).values({ tenantId: ctx.tenantId, botId: bot.id, version: max + 1, graph: JSON.parse(json), settings: snapshot as unknown as Record<string, unknown>, checksum, publishedBy: actorUserId(ctx) }).returning();
    await tx.update(bots).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(bots.id, bot.id));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "bot.published", targetType: "bot", targetId: bot.id, data: { version: v.version, checksum } }, tx);
    return { versionId: v.id, version: v.version, checksum };
  });
}

function snapshotOf(d: Awaited<ReturnType<typeof draftSettings>>): VersionSnapshot {
  return { instructionsVersion: INSTRUCTIONS_VERSION, company: d.company, role: d.role, instructions: d.instructions, allowedTools: d.allowedTools, handoffKeywords: d.handoffKeywords, aiConnectionId: d.aiConnectionId, model: d.model, config: d.config, productIds: [...d.productIds].sort() };
}
/** JSON con claves ordenadas: jsonb no conserva el orden de las claves. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
function snapshotChecksum(snap: VersionSnapshot, graph: unknown) {
  // versiones sin rol = "custom" (el valor por defecto): no aparecen como cambios sin publicar
  // la política de la empresa se compara por contenido (sin revisión) y una empresa vacía = sin datos
  const { instructionsVersion: _iv, ...rest } = snap;
  void _iv;
  const norm = { ...rest, company: snapshotKey(snap.company ?? null), role: snap.role ?? "custom", config: resolveBotConfig(snap.config), productIds: [...(snap.productIds ?? [])].sort() };
  return createHash("sha256").update(canonical({ s: norm, g: graph ?? null })).digest("hex").slice(0, 16);
}

/**
 * Recupera una versión anterior como borrador: copia su configuración (y su flujo) al bot.
 * No publica: para que vuelva a ejecutarse hay que publicar (queda una versión nueva, trazable).
 */
export async function restoreVersion(ctx: Ctx, botId: string, versionId: string) {
  assertCan(ctx, "bot:write");
  const bot = await db.query.bots.findFirst({ where: and(eq(bots.id, botId), eq(bots.tenantId, ctx.tenantId)) });
  if (!bot) throw notFound();
  const v = await db.query.botVersions.findFirst({ where: and(eq(botVersions.id, versionId), eq(botVersions.botId, botId), eq(botVersions.tenantId, ctx.tenantId)) });
  if (!v) throw notFound("Versión inexistente.");
  const s = (v.settings ?? null) as VersionSnapshot | null;
  await db.transaction(async (tx) => {
    const patch: Partial<typeof bots.$inferInsert> = { updatedAt: new Date() };
    if (s) {
      patch.instructions = s.instructions;
      if (s.role) patch.role = s.role;
      patch.allowedTools = s.allowedTools;
      patch.handoffKeywords = s.handoffKeywords;
      patch.config = resolveBotConfig(s.config) as unknown as Record<string, unknown>;
      patch.model = s.model;
      // la conexión de IA solo se restaura si sigue vigente
      if (s.aiConnectionId) {
        const c = await tx.query.aiProviderConnections.findFirst({ where: and(eq(aiProviderConnections.id, s.aiConnectionId), eq(aiProviderConnections.tenantId, ctx.tenantId)) });
        if (c && c.status !== "revoked") patch.aiConnectionId = s.aiConnectionId;
      }
      await tx.delete(botProducts).where(and(eq(botProducts.botId, botId), eq(botProducts.tenantId, ctx.tenantId)));
      const keep = s.productIds?.length ? (await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, ctx.tenantId), sql`${products.id} in ${s.productIds}`, sql`${products.archivedAt} is null`))).map((r) => r.id) : [];
      if (keep.length) await tx.insert(botProducts).values(keep.map((productId) => ({ tenantId: ctx.tenantId, botId, productId })));
    }
    if (bot.mode === "flow") {
      patch.draftGraph = v.graph;
      patch.draftRevision = sql`${bots.draftRevision} + 1` as unknown as number;
    }
    await tx.update(bots).set(patch).where(eq(bots.id, botId));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "bot.version_restored", targetType: "bot", targetId: botId, data: { version: v.version } }, tx);
  });
  return { restored: v.version, settingsRestored: Boolean(s) };
}

export async function setBotStatus(ctx: Ctx, id: string, status: "active" | "inactive") {
  assertCan(ctx, "bot:publish");
  return db.transaction(async (tx) => {
    const bot = await tx.query.bots.findFirst({ where: and(eq(bots.id, id), eq(bots.tenantId, ctx.tenantId)) });
    if (!bot) throw notFound();
    if (status === "active") {
      if (!bot.publishedVersionId) throw badRequest("Publicá una versión antes de activar el bot.");
      // un bot que ya cuenta por estar en un equipo activo no suma de nuevo
      const inActiveTeam = await tx.execute<{ n: number }>(sql`select count(*)::int as n from bot_team_members m join bot_teams t on t.id = m.team_id where m.bot_id = ${bot.id} and t.status = 'active'`);
      if (bot.status !== "active" && !inActiveTeam.rows[0]?.n) await assertResourceQuota(tx, ctx.tenantId, "activeBots", 1);
    }
    await tx.update(bots).set({ status, updatedAt: new Date() }).where(eq(bots.id, id));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: `bot.${status === "active" ? "activated" : "deactivated"}`, targetType: "bot", targetId: id }, tx);
  });
}

export async function listRuns(ctx: Ctx, botId: string) {
  assertCan(ctx, "bot:read");
  const runs = await db
    .select({ id: flowRuns.id, status: flowRuns.status, conversationId: flowRuns.conversationId, versionId: flowRuns.versionId, stepCount: flowRuns.stepCount, lastError: flowRuns.lastError, startedAt: flowRuns.startedAt, finishedAt: flowRuns.finishedAt, version: botVersions.version, metrics: flowRuns.metrics })
    .from(flowRuns)
    .innerJoin(botVersions, eq(botVersions.id, flowRuns.versionId))
    .where(and(eq(flowRuns.tenantId, ctx.tenantId), eq(flowRuns.botId, botId)))
    .orderBy(desc(flowRuns.startedAt))
    .limit(30);
  const steps = runs.length
    ? await db.select().from(flowRunSteps).where(and(eq(flowRunSteps.tenantId, ctx.tenantId), sql`${flowRunSteps.runId} in ${runs.map((r) => r.id)}`)).orderBy(asc(flowRunSteps.createdAt))
    : [];
  return runs.map((r) => ({ ...r, steps: steps.filter((s) => s.runId === r.id).map((s) => ({ nodeType: s.nodeType, summary: s.summary, at: s.createdAt })) }));
}

/**
 * Aplica la política vigente de la empresa a los bots publicados que tienen una copia anterior:
 * publica una versión nueva de cada uno (trazable en Versiones). Los borradores con otros cambios
 * sin publicar NO se tocan, para no publicar cambios que nadie revisó.
 */
export async function republishOutdatedBots(ctx: Ctx) {
  assertCan(ctx, "bot:publish");
  const rows = await db.select().from(bots).where(eq(bots.tenantId, ctx.tenantId));
  const current = snapshotKey(await companySnapshot(ctx.tenantId));
  const done: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const b of rows) {
    if (!b.publishedVersionId) continue;
    const v = await db.query.botVersions.findFirst({ where: eq(botVersions.id, b.publishedVersionId) });
    const snap = (v?.settings ?? null) as VersionSnapshot | null;
    if (JSON.stringify(snapshotKey(snap?.company ?? null)) === JSON.stringify(current)) continue;
    // ¿hay otros cambios sin publicar además de la política de la empresa?
    const draft = await draftSettings(b);
    const sameExceptCompany = snap && snapshotChecksum({ ...snapshotOf(draft), company: snap.company ?? null }, b.mode === "flow" ? b.draftGraph : null) === snapshotChecksum(snap, b.mode === "flow" ? v!.graph : null);
    if (!sameExceptCompany) {
      skipped.push({ name: b.name, reason: "tiene otros cambios sin publicar: revisalo y publicalo desde el bot" });
      continue;
    }
    try {
      await publishBot(ctx, b.id);
      done.push(b.name);
    } catch (e) {
      skipped.push({ name: b.name, reason: (e as Error).message });
    }
  }
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_profile.applied", data: { published: done.length, skipped: skipped.length } });
  return { published: done, skipped };
}
