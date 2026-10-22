import { platformRoute, readJson } from "@/server/http/api";
import { createTenant, createTenantSchema, listTenantsForPlatform } from "@/server/services/tenants";

export const GET = platformRoute(async () => listTenantsForPlatform());
export const POST = platformRoute(async ({ req, user }) => {
  const res = await createTenant(await readJson(req, createTenantSchema), user.id);
  return { tenant: res.tenant, invitation: { email: res.invitation.email, devUrl: process.env.NODE_ENV !== "production" && !process.env.SMTP_URL ? res.invitation.url : undefined } };
});
