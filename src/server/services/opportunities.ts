import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { contacts, conversations, internalNotes, memberships, opportunities, opportunityHistory, pipelines, stages, tasks, user as userTable } from "../db/schema";
import { actorKind, actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import { assertOperational } from "./usage";
import { enqueue } from "../jobs/queue";

const money = z
  .union([z.number(), z.string()])
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e12), "Importe inválido.")
  .nullable();

export const createOpportunitySchema = z.object({
  contactId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  amount: money.optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  ownerUserId: z.string().optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  followUpAt: z.coerce.date().optional().nullable(),
  source: z.enum(["manual", "whatsapp", "bot"]).optional(),
});

async function assertMember(tx: Tx | typeof db, tenantId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await tx.query.memberships.findFirst({ where: and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")) });
  if (!m) throw badRequest("El responsable debe ser un miembro activo de la empresa.");
}

async function stageInTenant(tx: Tx | typeof db, tenantId: string, stageId: string) {
  const s = await tx.query.stages.findFirst({ where: and(eq(stages.id, stageId), eq(stages.tenantId, tenantId)) });
  if (!s) throw notFound("Etapa inexistente.");
  return s;
}

async function history(tx: Tx, ctx: Ctx, opportunityId: string, field: string, from: unknown, to: unknown) {
  await tx.insert(opportunityHistory).values({
    tenantId: ctx.tenantId,
    opportunityId,
    actorKind: actorKind(ctx),
    actorUserId: actorUserId(ctx),
    field,
    fromValue: from === null || from === undefined ? null : String(from),
    toValue: to === null || to === undefined ? null : String(to),
  });
}

export async function createOpportunity(ctx: Ctx, input: z.input<typeof createOpportunitySchema>, txIn?: Tx) {
  assertCan(ctx, "opportunity:write");
  const data = createOpportunitySchema.parse(input);
  const run = async (tx: Tx) => {
    await assertOperational(ctx.tenantId, tx);
    const contact = await tx.query.contacts.findFirst({ where: and(eq(contacts.id, data.contactId), eq(contacts.tenantId, ctx.tenantId)) });
    if (!contact) throw notFound("Contacto inexistente.");
    if (data.conversationId) {
      const conv = await tx.query.conversations.findFirst({ where: and(eq(conversations.id, data.conversationId), eq(conversations.tenantId, ctx.tenantId)) });
      if (!conv) throw notFound("Conversación inexistente.");
    }
    await assertMember(tx, ctx.tenantId, data.ownerUserId);
    let stage;
    if (data.stageId) stage = await stageInTenant(tx, ctx.tenantId, data.stageId);
    else {
      const p = data.pipelineId
        ? await tx.query.pipelines.findFirst({ where: and(eq(pipelines.id, data.pipelineId), eq(pipelines.tenantId, ctx.tenantId)) })
        : await tx.query.pipelines.findFirst({ where: and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)) });
      if (!p) throw notFound("Pipeline inexistente.");
      stage = await tx.query.stages.findFirst({ where: and(eq(stages.pipelineId, p.id), eq(stages.kind, "open")), orderBy: [asc(stages.position)] });
      if (!stage) throw badRequest("El pipeline no tiene etapas abiertas.");
    }
    const [opp] = await tx
      .insert(opportunities)
      .values({
        tenantId: ctx.tenantId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        contactId: contact.id,
        conversationId: data.conversationId ?? null,
        title: data.title,
        status: stage.kind,
        ownerUserId: data.ownerUserId ?? actorUserId(ctx),
        amount: data.amount === null || data.amount === undefined ? null : String(data.amount),
        currency: data.currency ?? "ARS",
        source: data.source ?? (ctx.actor.kind === "bot" ? "bot" : "manual"),
        followUpAt: data.followUpAt ?? null,
        closedAt: stage.kind === "open" ? null : new Date(),
      })
      .returning();
    await history(tx, ctx, opp.id, "created", null, stage.name);
    await enqueue("team.automation", { opportunityId: opp.id, stageId: stage.id, stageKind: stage.kind, pipelineId: stage.pipelineId }, { tenantId: ctx.tenantId, dedupKey: `opp-stage:${opp.id}:${opp.version}`, maxAttempts: 3 }, tx);
    return opp;
  };
  return txIn ? run(txIn) : db.transaction(run);
}

export const updateOpportunitySchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(2).max(120).optional(),
  stageId: z.string().uuid().optional(),
  amount: money.optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  ownerUserId: z.string().nullable().optional(),
  followUpAt: z.coerce.date().nullable().optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
});

/**
 * Actualización con control de concurrencia optimista (version). Si otra persona cambió la
 * oportunidad, responde 409 con la versión vigente: nunca se pisa en silencio.
 */
export async function updateOpportunity(ctx: Ctx, id: string, input: z.input<typeof updateOpportunitySchema>) {
  assertCan(ctx, "opportunity:write");
  const data = updateOpportunitySchema.parse(input);
  return db.transaction(async (tx) => {
    await assertOperational(ctx.tenantId, tx);
    const opp = await tx.query.opportunities.findFirst({ where: and(eq(opportunities.id, id), eq(opportunities.tenantId, ctx.tenantId)) });
    if (!opp) throw notFound();
    if (opp.version !== data.expectedVersion) {
      throw conflict("Otra persona modificó esta oportunidad. Revisá los cambios y volvé a intentar.", { current: { ...opp } });
    }
    const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date(), lastActivityAt: new Date(), version: opp.version + 1 };
    if (data.title !== undefined && data.title !== opp.title) {
      patch.title = data.title;
      await history(tx, ctx, id, "title", opp.title, data.title);
    }
    if (data.stageId && data.stageId !== opp.stageId) {
      const to = await stageInTenant(tx, ctx.tenantId, data.stageId);
      if (to.pipelineId !== opp.pipelineId) throw badRequest("La etapa pertenece a otro pipeline.");
      const from = await tx.query.stages.findFirst({ where: eq(stages.id, opp.stageId) });
      patch.stageId = to.id;
      patch.status = to.kind;
      patch.closedAt = to.kind === "open" ? null : new Date();
      if (to.kind !== "lost") patch.lostReason = null;
      await history(tx, ctx, id, "stage", from?.name, to.name);
      if (to.kind !== (from?.kind ?? "open")) await history(tx, ctx, id, "status", from?.kind, to.kind);
    }
    if (data.amount !== undefined) {
      const next = data.amount === null ? null : Number(data.amount).toFixed(2);
      if (next !== opp.amount) {
        patch.amount = next;
        await history(tx, ctx, id, "amount", opp.amount, next);
      }
    }
    if (data.currency && data.currency !== opp.currency) {
      patch.currency = data.currency;
      await history(tx, ctx, id, "currency", opp.currency, data.currency);
    }
    if (data.ownerUserId !== undefined && data.ownerUserId !== opp.ownerUserId) {
      await assertMember(tx, ctx.tenantId, data.ownerUserId);
      patch.ownerUserId = data.ownerUserId;
      await history(tx, ctx, id, "owner", opp.ownerUserId, data.ownerUserId);
    }
    if (data.followUpAt !== undefined) {
      patch.followUpAt = data.followUpAt;
      await history(tx, ctx, id, "follow_up", opp.followUpAt?.toISOString(), data.followUpAt?.toISOString());
    }
    if (data.lostReason !== undefined) patch.lostReason = data.lostReason;
    const updated = await tx
      .update(opportunities)
      .set(patch)
      .where(and(eq(opportunities.id, id), eq(opportunities.version, opp.version)))
      .returning();
    if (updated.length === 0) throw conflict("Otra persona modificó esta oportunidad. Recargá y volvé a intentar.");
    // eventos del pipeline para las automatizaciones de equipos de chatbots (en la misma transacción)
    if (patch.stageId) await enqueue("team.automation", { opportunityId: id, stageId: patch.stageId, stageKind: patch.status, pipelineId: opp.pipelineId }, { tenantId: ctx.tenantId, dedupKey: `opp-stage:${id}:${updated[0].version}`, maxAttempts: 3 }, tx);
    return updated[0];
  });
}

export async function getBoard(ctx: Ctx, pipelineId?: string, q?: string) {
  assertCan(ctx, "opportunity:read");
  const p = pipelineId
    ? await db.query.pipelines.findFirst({ where: and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, ctx.tenantId)) })
    : ((await db.query.pipelines.findFirst({ where: and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.isDefault, true)) })) ??
      (await db.query.pipelines.findFirst({ where: eq(pipelines.tenantId, ctx.tenantId) })));
  if (!p) throw notFound("Pipeline inexistente.");
  const st = await db.select().from(stages).where(eq(stages.pipelineId, p.id)).orderBy(asc(stages.position));
  const filters = [eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.pipelineId, p.id)];
  if (q && q.trim()) {
    const like = `%${q.trim().replace(/[%_]/g, "")}%`;
    filters.push(or(ilike(opportunities.title, like), ilike(contacts.name, like))!);
  }
  const rows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      stageId: opportunities.stageId,
      status: opportunities.status,
      amount: opportunities.amount,
      currency: opportunities.currency,
      followUpAt: opportunities.followUpAt,
      lastActivityAt: opportunities.lastActivityAt,
      version: opportunities.version,
      source: opportunities.source,
      contactId: contacts.id,
      contactName: contacts.name,
      ownerUserId: opportunities.ownerUserId,
      ownerName: userTable.name,
      conversationId: opportunities.conversationId,
      openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.opportunity_id = "opportunities"."id" and t.status = 'pending')`,
    })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .leftJoin(userTable, eq(userTable.id, opportunities.ownerUserId))
    .where(and(...filters))
    .orderBy(desc(opportunities.lastActivityAt))
    .limit(1000);
  return { pipeline: p, stages: st, opportunities: rows };
}

export async function getOpportunityDetail(ctx: Ctx, id: string) {
  assertCan(ctx, "opportunity:read");
  const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.id, id), eq(opportunities.tenantId, ctx.tenantId)) });
  if (!opp) throw notFound();
  const [contact, stage, hist, notes, taskRows, pipelineStages] = await Promise.all([
    db.query.contacts.findFirst({ where: eq(contacts.id, opp.contactId) }),
    db.query.stages.findFirst({ where: eq(stages.id, opp.stageId) }),
    db
      .select({ id: opportunityHistory.id, field: opportunityHistory.field, fromValue: opportunityHistory.fromValue, toValue: opportunityHistory.toValue, actorKind: opportunityHistory.actorKind, actorName: userTable.name, createdAt: opportunityHistory.createdAt })
      .from(opportunityHistory)
      .leftJoin(userTable, eq(userTable.id, opportunityHistory.actorUserId))
      .where(eq(opportunityHistory.opportunityId, id))
      .orderBy(desc(opportunityHistory.createdAt))
      .limit(50),
    db
      .select({ id: internalNotes.id, body: internalNotes.body, authorName: userTable.name, createdAt: internalNotes.createdAt })
      .from(internalNotes)
      .leftJoin(userTable, eq(userTable.id, internalNotes.authorUserId))
      .where(and(eq(internalNotes.tenantId, ctx.tenantId), eq(internalNotes.opportunityId, id)))
      .orderBy(desc(internalNotes.createdAt)),
    db.select().from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.opportunityId, id))).orderBy(asc(tasks.dueAt)),
    db.select().from(stages).where(eq(stages.pipelineId, opp.pipelineId)).orderBy(asc(stages.position)),
  ]);
  return { opportunity: opp, contact, stage, history: hist, notes, tasks: taskRows, stages: pipelineStages };
}

export async function listContactOpportunities(ctx: Ctx, contactIds: string[]) {
  if (contactIds.length === 0) return [];
  return db
    .select({ id: opportunities.id, title: opportunities.title, status: opportunities.status, amount: opportunities.amount, currency: opportunities.currency, stageName: stages.name, contactId: opportunities.contactId, version: opportunities.version, stageId: opportunities.stageId, pipelineId: opportunities.pipelineId })
    .from(opportunities)
    .innerJoin(stages, eq(stages.id, opportunities.stageId))
    .where(and(eq(opportunities.tenantId, ctx.tenantId), inArray(opportunities.contactId, contactIds)))
    .orderBy(desc(opportunities.lastActivityAt));
}
