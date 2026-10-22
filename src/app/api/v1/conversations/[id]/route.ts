import { tenantRoute } from "@/server/http/api";
import { getConversationDetail, markRead } from "@/server/services/conversations";

export const GET = tenantRoute(async ({ req, ctx, params }) => {
  const before = req.nextUrl.searchParams.get("before");
  const detail = await getConversationDetail(ctx, params.id, { before: before ? Number(before) : undefined });
  if (!before) await markRead(ctx, params.id);
  return detail;
});
