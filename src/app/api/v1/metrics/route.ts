import { tenantRoute } from "@/server/http/api";
import { getDashboardMetrics, parseRange } from "@/server/services/metrics";

export const GET = tenantRoute(async ({ req, ctx }) => getDashboardMetrics(ctx, parseRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"))));
