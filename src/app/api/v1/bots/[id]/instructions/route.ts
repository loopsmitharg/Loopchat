import { tenantRoute } from "@/server/http/api";
import { getEffectiveInstructions } from "@/server/services/bot-instructions";

export const GET = tenantRoute(async ({ req, ctx, params }) => getEffectiveInstructions(ctx, params.id, req.nextUrl.searchParams.get("source") ?? "draft"));
