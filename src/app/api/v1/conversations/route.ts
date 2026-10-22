import { tenantRoute } from "@/server/http/api";
import { listConversations } from "@/server/services/conversations";

export const GET = tenantRoute(async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  return listConversations(ctx, {
    status: (sp.get("status") ?? undefined) as never,
    mode: (sp.get("mode") ?? undefined) as never,
    assignee: (sp.get("assignee") ?? undefined) as never,
    q: sp.get("q") ?? undefined,
    before: sp.get("before") ?? undefined,
  });
});
