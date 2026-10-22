import { platformRoute, readJson } from "@/server/http/api";
import { changeSubscription, changeSubscriptionSchema } from "@/server/services/plans";
import { getTenantForPlatform } from "@/server/services/tenants";

export const GET = platformRoute(async ({ params }) => getTenantForPlatform(params.id));
export const PATCH = platformRoute(async ({ req, user, params }) => {
  await changeSubscription(user.id, params.id, await readJson(req, changeSubscriptionSchema));
  return getTenantForPlatform(params.id);
});
