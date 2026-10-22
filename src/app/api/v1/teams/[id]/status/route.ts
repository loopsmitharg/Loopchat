import { z } from "zod";
import { tenantRoute, readJson } from "@/server/http/api";
import { setTeamStatus } from "@/server/services/teams";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { status } = await readJson(req, z.object({ status: z.enum(["active", "inactive"]) }));
  return setTeamStatus(ctx, params.id, status);
});
