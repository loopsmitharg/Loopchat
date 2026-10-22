import { tenantRoute, readJson } from "@/server/http/api";
import { savePipelineStages, saveStagesSchema } from "@/server/services/pipelines";

export const PUT = tenantRoute(async ({ req, ctx, params }) => savePipelineStages(ctx, params.id, await readJson(req, saveStagesSchema)));
