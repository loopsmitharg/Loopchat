import { tenantRoute } from "@/server/http/api";
import { retryOutbound } from "@/server/services/outbound";

export const POST = tenantRoute(async ({ ctx, params }) => retryOutbound(ctx, params.id), { permission: "conversation:reply", rateLimit: { max: 20 } });
