import { tenantRoute } from "@/server/http/api";
import { getUsageSummary } from "@/server/services/usage";

export const GET = tenantRoute(async ({ ctx }) => getUsageSummary(ctx.tenantId), { permission: "dashboard:read" });
