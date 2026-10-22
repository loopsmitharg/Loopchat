import { tenantRoute, readJson } from "@/server/http/api";
import { assertCan } from "@/server/authz/context";
import { notFound } from "@/server/http/errors";
import { contactLeadSummary, setContactLeadValue, setLeadValueSchema } from "@/server/services/lead-fields";

export const GET = tenantRoute(async ({ ctx, params }) => {
  assertCan(ctx, "contact:read");
  const r = await contactLeadSummary(ctx.tenantId, params.id);
  if (!r) throw notFound();
  return r;
});
export const PUT = tenantRoute(async ({ req, ctx, params }) => setContactLeadValue(ctx, params.id, await readJson(req, setLeadValueSchema)));
