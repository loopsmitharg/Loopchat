import { tenantRoute, readJson } from "@/server/http/api";
import { ruleUpdateSchema } from "@/lib/ai-profile";
import { deleteRule, updateRule } from "@/server/services/ai-profile";

export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateRule(ctx, params.id, await readJson(req, ruleUpdateSchema)));
export const DELETE = tenantRoute(async ({ ctx, params }) => deleteRule(ctx, params.id));
