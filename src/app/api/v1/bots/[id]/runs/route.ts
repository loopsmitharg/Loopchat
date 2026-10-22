import { tenantRoute } from "@/server/http/api";
import { listRuns } from "@/server/services/bots";

export const GET = tenantRoute(async ({ ctx, params }) => listRuns(ctx, params.id));
