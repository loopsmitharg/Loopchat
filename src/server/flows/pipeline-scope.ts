import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BotConfig } from "@/lib/bot-config";
import { db } from "../db";
import { opportunities, pipelines, stages } from "../db/schema";

type StageRow = typeof stages.$inferSelect;
type OppRow = typeof opportunities.$inferSelect;

/**
 * Alcance comercial de un bot: los pipelines que puede consultar y usar (principal + adicionales),
 * la oportunidad abierta del contacto dentro de ese alcance y las etapas a las que puede moverla.
 * Toda la autorización se calcula acá, en el servidor; el modelo solo ve nombres de etapas permitidas.
 */
export type PipelineScope = {
  primaryId: string | null;
  pipelineIds: string[];
  pipelineNames: Record<string, string>;
  /** Oportunidad abierta del contacto en un pipeline autorizado (prioriza el principal). */
  opp: OppRow | null;
  /** Etapas del pipeline donde se opera (el de la oportunidad o el principal). */
  all: StageRow[];
  /** Etapas permitidas para mover (abiertas, configuradas, y hacia adelante si así se definió). */
  allowed: StageRow[];
  /** Etapa donde se crean oportunidades nuevas. */
  initialStage: StageRow | null;
  /** Etapa de cotización (si está configurada y es válida). */
  quoteStage: StageRow | null;
};

export async function resolvePipelineIds(tenantId: string, cfg: BotConfig["pipeline"]) {
  const rows = await db.select({ id: pipelines.id, name: pipelines.name, isDefault: pipelines.isDefault }).from(pipelines).where(eq(pipelines.tenantId, tenantId)).orderBy(asc(pipelines.position));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const primary = (cfg.primaryPipelineId && byId.get(cfg.primaryPipelineId)) || rows.find((r) => r.isDefault) || rows[0] || null;
  const ids = primary ? [primary.id, ...cfg.extraPipelineIds.filter((id) => id !== primary.id && byId.has(id))] : [];
  return { primaryId: primary?.id ?? null, pipelineIds: [...new Set(ids)], names: Object.fromEntries(rows.map((r) => [r.id, r.name])) };
}

export async function pipelineScope(
  tenantId: string,
  config: BotConfig,
  contactId: string | null,
  /** Simulación: oportunidad ficticia por pipeline. */
  simOpps?: Record<string, { stageId: string; title: string }>,
): Promise<PipelineScope> {
  const { primaryId, pipelineIds, names } = await resolvePipelineIds(tenantId, config.pipeline);
  const empty: PipelineScope = { primaryId, pipelineIds, pipelineNames: names, opp: null, all: [], allowed: [], initialStage: null, quoteStage: null };
  if (!primaryId) return empty;

  let opp: OppRow | null = null;
  if (contactId) {
    const open = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, contactId), eq(opportunities.status, "open"), inArray(opportunities.pipelineId, pipelineIds)))
      .orderBy(desc(opportunities.lastActivityAt));
    opp = open.find((o) => o.pipelineId === primaryId) ?? open[0] ?? null;
  }
  const simOpp = !opp && simOpps ? (simOpps[primaryId] ? { pipelineId: primaryId, ...simOpps[primaryId] } : Object.entries(simOpps).filter(([p]) => pipelineIds.includes(p)).map(([p, o]) => ({ pipelineId: p, ...o }))[0]) : undefined;
  const workPipeline = opp?.pipelineId ?? simOpp?.pipelineId ?? primaryId;

  const scopeStages = await db.select().from(stages).where(and(eq(stages.tenantId, tenantId), inArray(stages.pipelineId, pipelineIds))).orderBy(asc(stages.position));
  const all = scopeStages.filter((s) => s.pipelineId === workPipeline);
  const ids = new Set(config.tools.allowedStageIds);
  const currentStageId = opp?.stageId ?? simOpp?.stageId ?? null;
  const current = currentStageId ? all.find((s) => s.id === currentStageId) : undefined;
  // nunca ganada/perdida: cerrar una venta requiere una condición comercial verificable (acción humana)
  let allowed = all.filter((s) => s.kind === "open" && (ids.size === 0 || ids.has(s.id)));
  if (config.pipeline.stageMoves === "forward_only" && current) allowed = allowed.filter((s) => s.position > current.position);

  const primaryStages = scopeStages.filter((s) => s.pipelineId === primaryId && s.kind === "open");
  const initialStage = (config.pipeline.initialStageId && primaryStages.find((s) => s.id === config.pipeline.initialStageId)) || primaryStages[0] || null;
  const q = config.pipeline.quoteStageId ? scopeStages.find((s) => s.id === config.pipeline.quoteStageId && s.kind === "open") ?? null : null;
  const quoteStage = q && q.pipelineId === workPipeline && (!current || config.pipeline.stageMoves !== "forward_only" || q.position > current.position) ? q : null;
  return { primaryId, pipelineIds, pipelineNames: names, opp, all, allowed, initialStage, quoteStage };
}
