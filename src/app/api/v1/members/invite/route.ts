import { tenantRoute, readJson } from "@/server/http/api";
import { createInvitation, inviteSchema } from "@/server/services/invitations";

export const POST = tenantRoute(
  async ({ req, ctx }) => {
    const body = await readJson(req, inviteSchema);
    const inv = await createInvitation({ tenantId: ctx.tenantId, actor: { kind: "tenant", ctx } }, body);
    // El enlace solo se devuelve en desarrollo (en producción viaja por email).
    return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, devUrl: process.env.NODE_ENV !== "production" && !process.env.SMTP_URL ? inv.url : undefined };
  },
  { permission: "members:manage", rateLimit: { max: 20 } },
);
