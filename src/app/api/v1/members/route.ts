import { tenantRoute } from "@/server/http/api";
import { listMembers } from "@/server/services/members";
import { listPendingInvitations } from "@/server/services/invitations";
import { hasPermission } from "@/server/authz/context";

export const GET = tenantRoute(async ({ ctx }) => ({
  members: await listMembers(ctx),
  invitations: hasPermission(ctx, "members:manage") ? await listPendingInvitations(ctx) : [],
}));
