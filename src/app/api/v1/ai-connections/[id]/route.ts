import { tenantRoute } from "@/server/http/api";
import { revokeAiConnection } from "@/server/services/ai-connections";

export const DELETE = tenantRoute(async ({ ctx, params }) => {
  await revokeAiConnection(ctx, params.id);
  return { ok: true };
});
