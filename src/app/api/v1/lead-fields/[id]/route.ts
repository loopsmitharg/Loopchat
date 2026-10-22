import { tenantRoute, readJson } from "@/server/http/api";
import { deactivateLeadField, leadFieldSchema, updateLeadField } from "@/server/services/lead-fields";

export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateLeadField(ctx, params.id, await readJson(req, leadFieldSchema.partial())));
export const DELETE = tenantRoute(async ({ ctx, params }) => deactivateLeadField(ctx, params.id));
