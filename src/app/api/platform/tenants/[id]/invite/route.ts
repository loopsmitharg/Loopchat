import { platformRoute, readJson } from "@/server/http/api";
import { createInvitation, inviteSchema } from "@/server/services/invitations";

export const POST = platformRoute(async ({ req, user, params }) => {
  const inv = await createInvitation({ tenantId: params.id, actor: { kind: "platform", userId: user.id } }, await readJson(req, inviteSchema));
  return { email: inv.email, role: inv.role, devUrl: process.env.NODE_ENV !== "production" && !process.env.SMTP_URL ? inv.url : undefined };
});
