import { tenantRoute } from "@/server/http/api";
import { publishTeam } from "@/server/services/teams";

export const POST = tenantRoute(async ({ ctx, params }) => publishTeam(ctx, params.id));
