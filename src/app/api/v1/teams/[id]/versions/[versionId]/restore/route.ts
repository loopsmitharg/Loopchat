import { tenantRoute } from "@/server/http/api";
import { restoreTeamVersion } from "@/server/services/teams";

export const POST = tenantRoute(async ({ ctx, params }) => restoreTeamVersion(ctx, params.id, params.versionId));
