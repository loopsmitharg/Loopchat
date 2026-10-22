import { tenantRoute, readJson } from "@/server/http/api";
import { botUpdateSchema, getBot, updateBotSettings } from "@/server/services/bots";

export const GET = tenantRoute(async ({ ctx, params }) => getBot(ctx, params.id));
export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateBotSettings(ctx, params.id, await readJson(req, botUpdateSchema)));
