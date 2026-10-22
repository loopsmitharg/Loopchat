import "server-only";
import { and, asc, count, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { opportunities, pipelines, stages } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import { audit } from "./audit";
import { assertResourceQuota } from "./usage";
import { DEFAULT_STAGE_TEMPLATE } from "@/lib/pipeline-template";

export async function listPipelines(ctx: Ctx) {
  assertCan(ctx, "opportunity:read");
  const ps = await db.select().from(pipelines).where(eq(pipelines.tenantId, ctx.tenantId)).orderBy(asc(pipelines.position), asc(pipelines.createdAt));
  const ss = ps.length
    ? await db.select().from(stages).where(and(eq(stages.tenantId, ctx.tenantId), inArray(stages.pipelineId, ps.map((p) => p.id)))).orderBy(asc(stages.position))
    : [];
  return ps.map((p) => ({ ...p, stages: ss.filter((s) => s.pipelineId === p.id) }));
}

export async function getPipeline(ctx: Ctx, pipelineId: string) {
  const p = await db.query.pipelines.findFirst({ where: and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, ctx.tenantId)) });
  if (!p) throw notFound();
  return p;
}

export const createPipelineSchema = z.object({ name: z.string().trim().min(2).max(60) });

export async function createPipeline(ctx: Ctx, input: z.input<typeof createPipelineSchema>) {
  assertCan(ctx, "pipeline:configure");
  const data = createPipelineSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertResourceQuota(tx, ctx.tenantId, "pipelines", 1);
    const [{ n }] = await tx.select({ n: count() }).from(pipelines).where(eq(pipelines.tenantId, ctx.tenantId));
    const [p] = await tx.insert(pipelines).values({ tenantId: ctx.tenantId, name: data.name, position: n, isDefault: n === 0 }).returning();
    await tx.insert(stages).values(DEFAULT_STAGE_TEMPLATE.map((s, i) => ({ tenantId: ctx.tenantId, pipelineId: p.id, name: s.name, kind: s.kind, position: i })));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "pipeline.created", targetType: "pipeline", targetId: p.id }, tx);
    return p;
  });
}

export const saveStagesSchema = z.object({
  name: z.string().trim().min(2).max(60),
  stages: z
    .array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), kind: z.enum(["open", "won", "lost"]) }))
    .min(3)
    .max(20),
});

/**
 * Guarda nombre y etapas (orden incluido). Reglas: ≥1 etapa abierta inicial, exactamente
 * una "ganada" y una "perdida"; no se borra una etapa con oportunidades.
 */
export async function savePipelineStages(ctx: Ctx, pipelineId: string, input: z.input<typeof saveStagesSchema>) {
  assertCan(ctx, "pipeline:configure");
  const data = saveStagesSchema.parse(input);
  if (data.stages[0].kind !== "open") throw badRequest("La primera etapa debe ser una etapa abierta (inicial).");
  if (data.stages.filter((s) => s.kind === "won").length !== 1) throw badRequest("Debe haber exactamente una etapa de cierre ganado.");
  if (data.stages.filter((s) => s.kind === "lost").length !== 1) throw badRequest("Debe haber exactamente una etapa de cierre perdido.");
  const names = data.stages.map((s) => s.name.toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest("Hay etapas con nombres repetidos.");
  return db.transaction(async (tx) => {
    const p = await tx.query.pipelines.findFirst({ where: and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, ctx.tenantId)) });
    if (!p) throw notFound();
    const current = await tx.select().from(stages).where(eq(stages.pipelineId, p.id));
    const keepIds = data.stages.map((s) => s.id).filter(Boolean) as string[];
    for (const id of keepIds) if (!current.some((c) => c.id === id)) throw notFound("Etapa inexistente.");
    const removed = current.filter((c) => !keepIds.includes(c.id));
    if (removed.length) {
      const [{ n }] = await tx.select({ n: count() }).from(opportunities).where(inArray(opportunities.stageId, removed.map((r) => r.id)));
      if (n > 0) throw conflict("No se puede eliminar una etapa que tiene oportunidades. Movelas primero.");
      await tx.delete(stages).where(and(eq(stages.pipelineId, p.id), notInArray(stages.id, keepIds.length ? keepIds : ["00000000-0000-0000-0000-000000000000"])));
    }
    for (const [i, s] of data.stages.entries()) {
      if (s.id) await tx.update(stages).set({ name: s.name, kind: s.kind, position: i }).where(eq(stages.id, s.id));
      else await tx.insert(stages).values({ tenantId: ctx.tenantId, pipelineId: p.id, name: s.name, kind: s.kind, position: i });
    }
    await tx.update(pipelines).set({ name: data.name, updatedAt: new Date() }).where(eq(pipelines.id, p.id));
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "pipeline.stages_saved", targetType: "pipeline", targetId: p.id, data: { stages: data.stages.map((s) => s.name) } }, tx);
    return tx.select().from(stages).where(eq(stages.pipelineId, p.id)).orderBy(asc(stages.position));
  });
}
