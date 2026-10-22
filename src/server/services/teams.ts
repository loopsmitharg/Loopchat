import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveBotConfig } from "@/lib/bot-config";
import { TEAM_INTENTS, type TeamGraph } from "@/lib/team/types";
import { validateTeamGraph, type TeamBotInfo, type TeamIssue, type TeamValidationContext } from "@/lib/team/validate";
import { db, type Tx } from "../db";
import { botTeamMembers, botTeamVersions, botTeams, botTransfers, botVersions, bots, channelConnections, conversations, pipelines, stages } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import type { VersionSnapshot } from "../flows/settings";
import { audit } from "./audit";
import { assertActiveBotsTotal, countActiveBots, getPlanState } from "./usage";

/* ------------------------------------------------------------------ */
/* Esquemas                                                             */
/* ------------------------------------------------------------------ */

const id = z.string().trim().min(1).max(64).regex(/^[\w-]+$/);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("intent"), intents: z.array(z.enum(TEAM_INTENTS)).max(TEAM_INTENTS.length) }),
  z.object({ kind: z.literal("keywords"), keywords: z.array(z.string().trim().max(40)).max(30) }),
  z.object({ kind: z.literal("ai"), description: z.string().trim().max(300) }),
]);

export const teamGraphSchema = z.object({
  nodes: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ id, type: z.literal("bot"), position, data: z.object({ botId: z.string().uuid(), disabled: z.boolean().optional() }) }),
        z.object({ id, type: z.literal("human"), position, data: z.object({}).strip() }),
      ]),
    )
    .max(30),
  edges: z.array(z.object({ id, source: id, target: id, data: z.object({ condition, enabled: z.boolean().default(true), label: z.string().trim().max(60).optional(), message: z.string().trim().max(300).optional() }) })).max(100),
  settings: z.object({
    entryNodeId: id.nullable(),
    unknownIntent: z.enum(["stay", "human"]).default("stay"),
    maxConsecutiveTransfers: z.number().int().min(1).max(10).default(3),
    fallback: z.enum(["entry", "human"]).default("entry"),
  }),
  automations: z
    .array(
      z.object({
        id,
        enabled: z.boolean().default(true),
        trigger: z.discriminatedUnion("kind", [z.object({ kind: z.literal("stage_entered"), stageId: z.string().uuid() }), z.object({ kind: z.literal("opportunity_closed"), pipelineId: z.string().uuid().nullable() })]),
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("activate_bot"), botId: z.string().uuid() }),
          z.object({ kind: z.literal("assign_owner"), userId: z.string().trim().min(1).max(100) }),
          z.object({ kind: z.literal("stop_bot"), botId: z.string().uuid().nullable() }),
        ]),
      }),
    )
    .max(30)
    .default([]),
});

export const teamInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(""),
  channelConnectionId: z.string().uuid().nullable().optional(),
  graph: teamGraphSchema.optional(),
});
export const teamUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  channelConnectionId: z.string().uuid().nullable().optional(),
});

export function parseTeamGraph(raw: unknown): TeamGraph {
  const r = teamGraphSchema.safeParse(raw);
  if (r.success) return r.data as TeamGraph;
  return { nodes: [], edges: [], settings: { entryNodeId: null, unknownIntent: "stay", maxConsecutiveTransfers: 3, fallback: "entry" }, automations: [] };
}

/* ------------------------------------------------------------------ */
/* Contexto de validación                                               */
/* ------------------------------------------------------------------ */

function botInfo(b: typeof bots.$inferSelect, snap: VersionSnapshot | null): TeamBotInfo {
  const cfg = resolveBotConfig(snap?.config ?? b.config);
  return {
    id: b.id,
    name: b.name,
    role: (snap?.role ?? b.role) as string,
    published: Boolean(b.publishedVersionId),
    allowedTools: (snap?.allowedTools ?? b.allowedTools) as string[],
    pipelineIds: [cfg.pipeline.primaryPipelineId, ...cfg.pipeline.extraPipelineIds].filter((x): x is string => Boolean(x)),
    allowedStageIds: cfg.tools.allowedStageIds,
    stageRefs: [cfg.pipeline.initialStageId, cfg.pipeline.quoteStageId].filter((x): x is string => Boolean(x)),
  };
}

/** Contexto con la configuración PUBLICADA de cada bot (es lo que el equipo va a ejecutar). */
export async function teamValidationContext(tenantId: string, graph: TeamGraph): Promise<TeamValidationContext> {
  const botIds = [...new Set(graph.nodes.flatMap((n) => (n.type === "bot" ? [n.data.botId] : [])))];
  const rows = botIds.length ? await db.select().from(bots).where(and(eq(bots.tenantId, tenantId), inArray(bots.id, botIds))) : [];
  const vIds = rows.map((r) => r.publishedVersionId).filter((x): x is string => Boolean(x));
  const vers = vIds.length ? await db.select({ id: botVersions.id, settings: botVersions.settings }).from(botVersions).where(inArray(botVersions.id, vIds)) : [];
  const snaps = new Map(vers.map((v) => [v.id, (v.settings ?? null) as VersionSnapshot | null]));
  const p = await db.select({ id: pipelines.id, isDefault: pipelines.isDefault }).from(pipelines).where(eq(pipelines.tenantId, tenantId));
  const st = await db.select({ id: stages.id, pipelineId: stages.pipelineId, kind: stages.kind }).from(stages).where(eq(stages.tenantId, tenantId));
  return {
    bots: new Map(rows.map((b) => [b.id, botInfo(b, b.publishedVersionId ? (snaps.get(b.publishedVersionId) ?? null) : null)])),
    pipelines: new Set(p.map((x) => x.id)),
    stages: new Map(st.map((s) => [s.id, { pipelineId: s.pipelineId, kind: s.kind }])),
    defaultPipelineId: p.find((x) => x.isDefault)?.id ?? p[0]?.id ?? null,
  };
}

export async function validateTeam(tenantId: string, graph: TeamGraph): Promise<TeamIssue[]> {
  return validateTeamGraph(graph, await teamValidationContext(tenantId, graph));
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                 */
/* ------------------------------------------------------------------ */

async function assertChannel(ctx: Ctx, channelConnectionId: string | null | undefined) {
  if (!channelConnectionId) return;
  const c = await db.query.channelConnections.findFirst({ where: and(eq(channelConnections.id, channelConnectionId), eq(channelConnections.tenantId, ctx.tenantId)) });
  if (!c) throw badRequest("Número de WhatsApp inexistente.");
}

async function assertGraphRefs(ctx: Ctx, graph: TeamGraph) {
  const botIds = graph.nodes.flatMap((n) => (n.type === "bot" ? [n.data.botId] : []));
  if (botIds.length) {
    const rows = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.tenantId, ctx.tenantId), inArray(bots.id, [...new Set(botIds)])));
    if (rows.length !== new Set(botIds).size) throw badRequest("El equipo incluye un bot que no existe en tu empresa.");
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) throw badRequest("Hay nodos repetidos.");
  if (JSON.stringify(graph).length > 200_000) throw badRequest("El equipo es demasiado grande.");
}

export async function listTeams(ctx: Ctx) {
  assertCan(ctx, "bot:read");
  const rows = await db
    .select({
      id: botTeams.id,
      name: botTeams.name,
      description: botTeams.description,
      status: botTeams.status,
      channelConnectionId: botTeams.channelConnectionId,
      publishedVersionId: botTeams.publishedVersionId,
      draftGraph: botTeams.draftGraph,
      updatedAt: botTeams.updatedAt,
      publishedVersion: sql<number | null>`(select v.version from ${botTeamVersions} v where v.id = "bot_teams"."published_version_id")`,
      transfers7d: sql<number>`(select count(*)::int from ${botTransfers} t where t.team_id = "bot_teams"."id" and t.created_at > now() - interval '7 days')`,
      conversations: sql<number>`(select count(*)::int from ${conversations} c where c.team_id = "bot_teams"."id" and c.status <> 'resolved')`,
    })
    .from(botTeams)
    .where(eq(botTeams.tenantId, ctx.tenantId))
    .orderBy(asc(botTeams.createdAt));
  return rows.map(({ draftGraph, ...r }) => ({ ...r, botCount: parseTeamGraph(draftGraph).nodes.filter((n) => n.type === "bot").length }));
}

export async function getTeam(ctx: Ctx, teamId: string) {
  assertCan(ctx, "bot:read");
  const t = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
  if (!t) throw notFound();
  const graph = parseTeamGraph(t.draftGraph);
  const versions = await db
    .select({ id: botTeamVersions.id, version: botTeamVersions.version, publishedAt: botTeamVersions.publishedAt, checksum: botTeamVersions.checksum })
    .from(botTeamVersions)
    .where(eq(botTeamVersions.teamId, teamId))
    .orderBy(desc(botTeamVersions.version))
    .limit(30);
  const published = t.publishedVersionId ? await db.query.botTeamVersions.findFirst({ where: eq(botTeamVersions.id, t.publishedVersionId) }) : null;
  const issues = await validateTeam(ctx.tenantId, graph);
  return {
    team: { ...t, draftGraph: graph },
    versions,
    published: published ? { id: published.id, version: published.version, graph: parseTeamGraph(published.graph), botVersions: published.botVersions } : null,
    issues,
    unpublishedChanges: published ? teamChecksum(graph) !== published.checksum.split(":")[0] : true,
  };
}

export async function createTeam(ctx: Ctx, input: z.input<typeof teamInputSchema>) {
  assertCan(ctx, "bot:write");
  const data = teamInputSchema.parse(input);
  await assertChannel(ctx, data.channelConnectionId);
  const graph = (data.graph ?? { nodes: [{ id: "human", type: "human", position: { x: 520, y: 320 }, data: {} }], edges: [], settings: { entryNodeId: null, unknownIntent: "stay", maxConsecutiveTransfers: 3, fallback: "entry" }, automations: [] }) as TeamGraph;
  await assertGraphRefs(ctx, graph);
  const [t] = await db.insert(botTeams).values({ tenantId: ctx.tenantId, name: data.name, description: data.description, channelConnectionId: data.channelConnectionId ?? null, draftGraph: graph }).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "team.created", targetType: "bot_team", targetId: t.id });
  return t;
}

export async function updateTeam(ctx: Ctx, teamId: string, input: z.input<typeof teamUpdateSchema>) {
  assertCan(ctx, "bot:write");
  const data = teamUpdateSchema.parse(input);
  await assertChannel(ctx, data.channelConnectionId);
  const res = await db.update(botTeams).set({ ...data, updatedAt: new Date() }).where(and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId))).returning();
  if (!res.length) throw notFound();
  return res[0];
}

/** Guarda el borrador (autoguardado del editor) con control de revisión optimista. */
export async function saveTeamDraft(ctx: Ctx, teamId: string, input: { graph: unknown; revision: number }) {
  assertCan(ctx, "bot:write");
  const graph = teamGraphSchema.parse(input.graph) as TeamGraph;
  await assertGraphRefs(ctx, graph);
  const res = await db
    .update(botTeams)
    .set({ draftGraph: graph, draftRevision: sql`${botTeams.draftRevision} + 1`, updatedAt: new Date() })
    .where(and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId), eq(botTeams.draftRevision, input.revision)))
    .returning({ draftRevision: botTeams.draftRevision });
  if (!res.length) {
    const exists = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
    if (!exists) throw notFound();
    throw conflict("El equipo fue modificado en otra pestaña o por otra persona. Recargá para ver la última versión.", { revision: exists.draftRevision });
  }
  return { revision: res[0].draftRevision, issues: await validateTeam(ctx.tenantId, graph) };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
/** Checksum del grafo sin posiciones (mover nodos no es un cambio funcional). */
export function teamChecksum(graph: TeamGraph) {
  const g = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: null })) };
  return createHash("sha256").update(canonical(g)).digest("hex").slice(0, 16);
}

/**
 * Publica una versión inmutable del equipo: fija la versión publicada de cada bot (el equipo
 * ejecuta exactamente esa combinación) y sincroniza los miembros (para cupos y borrados).
 * Política con conversaciones en curso: cada conversación conserva la versión del equipo con la
 * que empezó hasta que se resuelve; las nuevas usan la recién publicada.
 */
export async function publishTeam(ctx: Ctx, teamId: string) {
  assertCan(ctx, "bot:publish");
  const t = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
  if (!t) throw notFound();
  const graph = parseTeamGraph(t.draftGraph);
  const issues = (await validateTeam(ctx.tenantId, graph)).filter((i) => i.severity === "error");
  if (issues.length) throw badRequest("El equipo tiene errores. Corregilos antes de publicar.", { issues });
  const botIds = [...new Set(graph.nodes.flatMap((n) => (n.type === "bot" ? [n.data.botId] : [])))];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from bot_teams where id = ${teamId} for update`);
    const rows = await tx.select({ id: bots.id, publishedVersionId: bots.publishedVersionId }).from(bots).where(and(eq(bots.tenantId, ctx.tenantId), inArray(bots.id, botIds)));
    const pinned: Record<string, string> = {};
    for (const r of rows) {
      if (!r.publishedVersionId) throw badRequest("Un bot del equipo dejó de tener versión publicada.");
      pinned[r.id] = r.publishedVersionId;
    }
    if (t.status === "active") await assertTeamQuota(tx, ctx.tenantId, teamId, botIds);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${botTeamVersions.version}), 0)::int` }).from(botTeamVersions).where(eq(botTeamVersions.teamId, teamId));
    const checksum = `${teamChecksum(graph)}:${createHash("sha256").update(canonical(pinned)).digest("hex").slice(0, 8)}`;
    const [v] = await tx.insert(botTeamVersions).values({ tenantId: ctx.tenantId, teamId, version: max + 1, graph, botVersions: pinned, checksum, publishedBy: actorUserId(ctx) }).returning();
    await tx.update(botTeams).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(botTeams.id, teamId));
    await tx.delete(botTeamMembers).where(eq(botTeamMembers.teamId, teamId));
    if (botIds.length) await tx.insert(botTeamMembers).values(botIds.map((botId) => ({ tenantId: ctx.tenantId, teamId, botId })));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "team.published", targetType: "bot_team", targetId: teamId, data: { version: v.version, checksum } }, tx);
    return { versionId: v.id, version: v.version, checksum };
  });
}

/** Cupo de bots activos: cada bot cuenta una vez, sea activo individual o miembro de un equipo activo. */
async function assertTeamQuota(tx: Tx, tenantId: string, teamId: string, botIds: string[]) {
  const res = await tx.execute<{ id: string }>(sql`
    select b.id from bots b where b.tenant_id = ${tenantId} and (
      b.status = 'active' or exists (select 1 from bot_team_members m join bot_teams t on t.id = m.team_id where m.bot_id = b.id and t.status = 'active' and t.id <> ${teamId})
    )`);
  const others = new Set(res.rows.map((r) => r.id));
  const total = others.size + botIds.filter((b) => !others.has(b)).length;
  await assertActiveBotsTotal(tx, tenantId, total);
}

export async function setTeamStatus(ctx: Ctx, teamId: string, status: "active" | "inactive") {
  assertCan(ctx, "bot:publish");
  return db.transaction(async (tx) => {
    const t = await tx.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
    if (!t) throw notFound();
    if (status === "active") {
      if (!t.publishedVersionId) throw badRequest("Publicá el equipo antes de activarlo.");
      if (t.status !== "active") {
        const members = await tx.select({ botId: botTeamMembers.botId }).from(botTeamMembers).where(eq(botTeamMembers.teamId, teamId));
        await assertTeamQuota(tx, ctx.tenantId, teamId, members.map((m) => m.botId));
      }
    }
    await tx.update(botTeams).set({ status, updatedAt: new Date() }).where(eq(botTeams.id, teamId));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: `team.${status === "active" ? "activated" : "deactivated"}`, targetType: "bot_team", targetId: teamId }, tx);
    return { status, activeBots: await countActiveBots(tx, ctx.tenantId) };
  });
}

/** Recupera una versión publicada como borrador (no publica). */
export async function restoreTeamVersion(ctx: Ctx, teamId: string, versionId: string) {
  assertCan(ctx, "bot:write");
  const v = await db.query.botTeamVersions.findFirst({ where: and(eq(botTeamVersions.id, versionId), eq(botTeamVersions.teamId, teamId), eq(botTeamVersions.tenantId, ctx.tenantId)) });
  if (!v) throw notFound("Versión inexistente.");
  const graph = parseTeamGraph(v.graph);
  // bots eliminados desde entonces: se quitan del borrador (la validación lo informa)
  const ctxv = await teamValidationContext(ctx.tenantId, graph);
  const keep = graph.nodes.filter((n) => n.type === "human" || ctxv.bots.has(n.data.botId));
  const ids = new Set(keep.map((n) => n.id));
  const cleaned: TeamGraph = { ...graph, nodes: keep, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), settings: { ...graph.settings, entryNodeId: graph.settings.entryNodeId && ids.has(graph.settings.entryNodeId) ? graph.settings.entryNodeId : null } };
  await db.update(botTeams).set({ draftGraph: cleaned, draftRevision: sql`${botTeams.draftRevision} + 1`, updatedAt: new Date() }).where(and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)));
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "team.version_restored", targetType: "bot_team", targetId: teamId, data: { version: v.version } });
  return { restored: v.version, removedBots: graph.nodes.length - keep.length };
}

export async function deleteTeam(ctx: Ctx, teamId: string) {
  assertCan(ctx, "bot:publish");
  const t = await db.query.botTeams.findFirst({ where: and(eq(botTeams.id, teamId), eq(botTeams.tenantId, ctx.tenantId)) });
  if (!t) throw notFound();
  if (t.status === "active") throw badRequest("Desactivá el equipo antes de eliminarlo.");
  await db.transaction(async (tx) => {
    // las conversaciones que lo usaban quedan sin equipo (vuelven a la selección normal)
    await tx.update(conversations).set({ teamId: null, teamVersionId: null, activeBotId: null }).where(and(eq(conversations.tenantId, ctx.tenantId), eq(conversations.teamId, teamId)));
    await tx.delete(botTeams).where(eq(botTeams.id, teamId));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "team.deleted", targetType: "bot_team", targetId: teamId }, tx);
  });
  return { ok: true };
}

export async function listTeamTransfers(ctx: Ctx, teamId: string) {
  assertCan(ctx, "bot:read");
  const rows = await db
    .select({
      id: botTransfers.id,
      conversationId: botTransfers.conversationId,
      fromBotId: botTransfers.fromBotId,
      toBotId: botTransfers.toBotId,
      toHuman: botTransfers.toHuman,
      kind: botTransfers.kind,
      intent: botTransfers.intent,
      reason: botTransfers.reason,
      teamVersionId: botTransfers.teamVersionId,
      createdAt: botTransfers.createdAt,
    })
    .from(botTransfers)
    .where(and(eq(botTransfers.tenantId, ctx.tenantId), eq(botTransfers.teamId, teamId)))
    .orderBy(desc(botTransfers.createdAt))
    .limit(100);
  const vIds = [...new Set(rows.map((r) => r.teamVersionId).filter((x): x is string => Boolean(x)))];
  const vers = vIds.length ? await db.select({ id: botTeamVersions.id, version: botTeamVersions.version }).from(botTeamVersions).where(inArray(botTeamVersions.id, vIds)) : [];
  const vmap = new Map(vers.map((v) => [v.id, v.version]));
  return rows.map((r) => ({ ...r, version: r.teamVersionId ? (vmap.get(r.teamVersionId) ?? null) : null }));
}

/** Equipos activos que usan un bot (para avisos al desactivar o editar un bot). */
export async function teamsUsingBot(tenantId: string, botId: string) {
  return db
    .select({ id: botTeams.id, name: botTeams.name, status: botTeams.status })
    .from(botTeamMembers)
    .innerJoin(botTeams, eq(botTeams.id, botTeamMembers.teamId))
    .where(and(eq(botTeamMembers.tenantId, tenantId), eq(botTeamMembers.botId, botId)));
}

export async function planAllowsTeams(tenantId: string) {
  const plan = await getPlanState(tenantId);
  return (plan.limits.activeBots ?? 99) >= 2;
}

/** Equipos (borradores) en los que participa un bot y sus derivaciones, para la configuración del bot. */
export async function teamsForBot(ctx: Ctx, botId: string) {
  assertCan(ctx, "bot:read");
  const rows = await db.select().from(botTeams).where(eq(botTeams.tenantId, ctx.tenantId)).orderBy(asc(botTeams.createdAt));
  const allBots = await db.select({ id: bots.id, name: bots.name }).from(bots).where(eq(bots.tenantId, ctx.tenantId));
  const nameOfBot = new Map(allBots.map((b) => [b.id, b.name]));
  const out = [];
  for (const t of rows) {
    const g = parseTeamGraph(t.draftGraph);
    const self = g.nodes.find((n) => n.type === "bot" && n.data.botId === botId);
    if (!self) continue;
    const label = (nodeId: string) => {
      const n = g.nodes.find((x) => x.id === nodeId);
      return !n ? "?" : n.type === "human" ? "Atención humana" : (nameOfBot.get(n.data.botId) ?? "Bot eliminado");
    };
    out.push({
      id: t.id,
      name: t.name,
      status: t.status,
      isEntry: g.settings.entryNodeId === self.id,
      disabled: self.type === "bot" && Boolean(self.data.disabled),
      fallback: g.settings.fallback,
      outgoing: g.edges.filter((e) => e.source === self.id).map((e) => ({ to: label(e.target), condition: e.data.condition, enabled: e.data.enabled, message: e.data.message ?? "" })),
      incoming: g.edges.filter((e) => e.target === self.id).map((e) => ({ from: label(e.source), condition: e.data.condition, enabled: e.data.enabled })),
    });
  }
  return out;
}
