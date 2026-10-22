import { tenantRoute } from "@/server/http/api";
import { getBoard } from "@/server/services/opportunities";

export const GET = tenantRoute(async ({ req, ctx }) => getBoard(ctx, req.nextUrl.searchParams.get("pipelineId") ?? undefined, req.nextUrl.searchParams.get("q") ?? undefined));
