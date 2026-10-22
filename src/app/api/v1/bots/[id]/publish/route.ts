import { tenantRoute } from "@/server/http/api";
import { publishBot } from "@/server/services/bots";

export const POST = tenantRoute(async ({ ctx, params }) => publishBot(ctx, params.id));
