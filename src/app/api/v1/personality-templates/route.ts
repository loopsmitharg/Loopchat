import { tenantRoute, readJson } from "@/server/http/api";
import { createTemplate, listTemplates, templateInputSchema } from "@/server/services/ai-profile";

export const GET = tenantRoute(async ({ ctx }) => listTemplates(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createTemplate(ctx, await readJson(req, templateInputSchema)));
