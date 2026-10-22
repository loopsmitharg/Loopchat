import { tenantRoute } from "@/server/http/api";
import { restoreVersion } from "@/server/services/bots";

export const POST = tenantRoute(async ({ ctx, params }) => restoreVersion(ctx, params.id, params.versionId));
