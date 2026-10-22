import { tenantRoute, readJson } from "@/server/http/api";
import { assignConversation, assignSchema } from "@/server/services/conversations";

export const POST = tenantRoute(async ({ req, ctx, params }) => assignConversation(ctx, params.id, await readJson(req, assignSchema)));
