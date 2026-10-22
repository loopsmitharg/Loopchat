import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { setConversationStatus } from "@/server/services/conversations";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { status } = await readJson(req, z.object({ status: z.enum(["open", "pending", "resolved"]) }));
  return setConversationStatus(ctx, params.id, status);
});
