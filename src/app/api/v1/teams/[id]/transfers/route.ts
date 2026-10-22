import { tenantRoute } from "@/server/http/api";
import { listTeamTransfers } from "@/server/services/teams";

export const GET = tenantRoute(async ({ ctx, params }) => listTeamTransfers(ctx, params.id));
