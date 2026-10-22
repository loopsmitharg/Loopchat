import { tenantRoute, readJson } from "@/server/http/api";
import { getOpportunityDetail, updateOpportunity, updateOpportunitySchema } from "@/server/services/opportunities";

export const GET = tenantRoute(async ({ ctx, params }) => getOpportunityDetail(ctx, params.id));
export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateOpportunity(ctx, params.id, await readJson(req, updateOpportunitySchema)));
