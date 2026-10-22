import { tenantRoute, readJson } from "@/server/http/api";
import { botControlSchema, setAttentionMode } from "@/server/services/conversations";

export const POST = tenantRoute(async ({ req, ctx, params }) => setAttentionMode(ctx, params.id, await readJson(req, botControlSchema)));
