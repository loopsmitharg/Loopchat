import { tenantRoute } from "@/server/http/api";
import { reverifyChannel } from "@/server/services/channels";

export const POST = tenantRoute(async ({ ctx, params }) => reverifyChannel(ctx, params.id), { rateLimit: { max: 10 } });
