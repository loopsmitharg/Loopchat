import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { setBotStatus } from "@/server/services/bots";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { status } = await readJson(req, z.object({ status: z.enum(["active", "inactive"]) }));
  await setBotStatus(ctx, params.id, status);
  return { ok: true };
});
