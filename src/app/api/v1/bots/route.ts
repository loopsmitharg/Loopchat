import { tenantRoute, readJson } from "@/server/http/api";
import { botInputSchema, createBot, listBots } from "@/server/services/bots";

export const GET = tenantRoute(async ({ ctx }) => listBots(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createBot(ctx, await readJson(req, botInputSchema)));
