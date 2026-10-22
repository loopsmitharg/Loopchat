import { tenantRoute, readJson } from "@/server/http/api";
import { createLeadField, leadFieldSchema, listLeadFields } from "@/server/services/lead-fields";

export const GET = tenantRoute(async ({ ctx }) => listLeadFields(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createLeadField(ctx, await readJson(req, leadFieldSchema)));
