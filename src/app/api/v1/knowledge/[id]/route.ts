import { tenantRoute } from "@/server/http/api";
import { deleteKnowledge } from "@/server/services/knowledge";

export const DELETE = tenantRoute(async ({ ctx, params }) => {
  await deleteKnowledge(ctx, params.id);
  return { ok: true };
});
