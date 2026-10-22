import { tenantRoute, readJson } from "@/server/http/api";
import { createPipeline, createPipelineSchema, listPipelines } from "@/server/services/pipelines";

export const GET = tenantRoute(async ({ ctx }) => listPipelines(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createPipeline(ctx, await readJson(req, createPipelineSchema)));
