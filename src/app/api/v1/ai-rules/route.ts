import { tenantRoute, readJson } from "@/server/http/api";
import { ruleInputSchema } from "@/lib/ai-profile";
import { createRule } from "@/server/services/ai-profile";

export const POST = tenantRoute(async ({ req, ctx }) => createRule(ctx, await readJson(req, ruleInputSchema)));
