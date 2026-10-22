import { tenantRoute } from "@/server/http/api";
import { teamsForBot } from "@/server/services/teams";

export const GET = tenantRoute(async ({ ctx, params }) => teamsForBot(ctx, params.id));
