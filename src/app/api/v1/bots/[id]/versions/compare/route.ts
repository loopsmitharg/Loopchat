import { tenantRoute } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";
import { compareVersions } from "@/server/services/bot-instructions";

const ok = (v: string | null) => v === "draft" || v === "published" || (v !== null && /^[0-9a-f-]{36}$/.test(v));

export const GET = tenantRoute(async ({ req, ctx, params }) => {
  const a = req.nextUrl.searchParams.get("a");
  const b = req.nextUrl.searchParams.get("b");
  if (!ok(a) || !ok(b)) throw badRequest("Elegí dos versiones para comparar.");
  return compareVersions(ctx, params.id, a!, b!);
});
