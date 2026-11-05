import "server-only";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { contacts, memberships, opportunities, tasks, user as userTable } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { assertOperational } from "./usage";

export const taskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  opportunityId: z.string().uuid().optional().nullable(),
});

/**
 * `opts.tx`: ejecuta dentro de la transacción del llamador (p. ej. la autoridad del bot).
 * `opts.idempotencyKey`: una tarea por clave (un reintento devuelve la existente, no duplica).
 */
export async function createTask(ctx: Ctx, input: z.input<typeof taskSchema>, opts: { tx?: Tx | typeof db; idempotencyKey?: string | null } = {}) {
  assertCan(ctx, "task:write");
  const data = taskSchema.parse(input);
  const runner = opts.tx ?? db;
  await assertOperational(ctx.tenantId, runner);
  if (opts.idempotencyKey) {
    const existing = await runner.query.tasks.findFirst({ where: and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.idempotencyKey, opts.idempotencyKey)) });
    if (existing) return existing;
  }
  if (data.assigneeUserId) {
    const m = await runner.query.memberships.findFirst({ where: and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, data.assigneeUserId), eq(memberships.status, "active")) });
    if (!m) throw badRequest("El responsable debe ser miembro activo.");
  }
  if (data.contactId && !(await runner.query.contacts.findFirst({ where: and(eq(contacts.id, data.contactId), eq(contacts.tenantId, ctx.tenantId)) }))) throw notFound();
  let contactId = data.contactId ?? null;
  if (data.opportunityId) {
    const o = await runner.query.opportunities.findFirst({ where: and(eq(opportunities.id, data.opportunityId), eq(opportunities.tenantId, ctx.tenantId)) });
    if (!o) throw notFound();
    contactId = contactId ?? o.contactId;
  }
  const [t] = await runner
    .insert(tasks)
    .values({
      tenantId: ctx.tenantId,
      title: data.title,
      description: data.description ?? null,
      assigneeUserId: data.assigneeUserId ?? actorUserId(ctx),
      dueAt: data.dueAt ?? null,
      contactId,
      opportunityId: data.opportunityId ?? null,
      createdBy: actorUserId(ctx),
      createdByKind: ctx.actor.kind === "bot" ? "bot" : "user",
      idempotencyKey: opts.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!t && opts.idempotencyKey) return (await runner.query.tasks.findFirst({ where: and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.idempotencyKey, opts.idempotencyKey)) }))!;
  return t;
}

export async function setTaskStatus(ctx: Ctx, id: string, status: "pending" | "done" | "cancelled") {
  assertCan(ctx, "task:write");
  const res = await db
    .update(tasks)
    .set({ status, completedAt: status === "done" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId)))
    .returning();
  if (res.length === 0) throw notFound();
  return res[0];
}

export async function listTasks(ctx: Ctx, opts: { scope?: "mine" | "all"; status?: "pending" | "done" | "cancelled"; dueBefore?: Date } = {}) {
  assertCan(ctx, "task:read");
  const filters = [eq(tasks.tenantId, ctx.tenantId), eq(tasks.status, opts.status ?? "pending")];
  if (opts.scope === "mine" && ctx.actor.kind === "user") filters.push(or(eq(tasks.assigneeUserId, ctx.actor.userId), isNull(tasks.assigneeUserId))!);
  if (opts.dueBefore) filters.push(lte(tasks.dueAt, opts.dueBefore));
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      dueAt: tasks.dueAt,
      assigneeUserId: tasks.assigneeUserId,
      assigneeName: userTable.name,
      contactId: tasks.contactId,
      contactName: contacts.name,
      opportunityId: tasks.opportunityId,
      opportunityTitle: opportunities.title,
      createdByKind: tasks.createdByKind,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .leftJoin(userTable, eq(userTable.id, tasks.assigneeUserId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(...filters))
    .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt))
    .limit(300);
}
