import { tenantRoute, readJson } from "@/server/http/api";
import { contactInputSchema, getContact, updateContact } from "@/server/services/contacts";

export const GET = tenantRoute(async ({ ctx, params }) => getContact(ctx, params.id));
export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateContact(ctx, params.id, await readJson(req, contactInputSchema.partial())));
