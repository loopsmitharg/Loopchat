import { tenantRoute, readJson } from "@/server/http/api";
import { updateMember, updateMemberSchema } from "@/server/services/members";

export const PATCH = tenantRoute(async ({ req, ctx, params }) => {
  await updateMember(ctx, params.id, await readJson(req, updateMemberSchema));
  return { ok: true };
});
