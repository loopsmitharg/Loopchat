import { tenantRoute } from "@/server/http/api";
import { testAiConnection } from "@/server/services/ai-connections";

export const POST = tenantRoute(async ({ ctx, params }) => testAiConnection(ctx, params.id), { rateLimit: { max: 6 } });
