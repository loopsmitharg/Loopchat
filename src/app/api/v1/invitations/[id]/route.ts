import { tenantRoute } from "@/server/http/api";
import { revokeInvitation } from "@/server/services/invitations";

export const DELETE = tenantRoute(async ({ ctx, params }) => {
  await revokeInvitation(ctx, params.id);
  return { ok: true };
});
