import { tenantRoute, readJson } from "@/server/http/api";
import { createOpportunity, createOpportunitySchema } from "@/server/services/opportunities";

export const POST = tenantRoute(async ({ req, ctx }) => createOpportunity(ctx, await readJson(req, createOpportunitySchema)));
