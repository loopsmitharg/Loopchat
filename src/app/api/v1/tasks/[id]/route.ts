import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { setTaskStatus } from "@/server/services/tasks";

export const PATCH = tenantRoute(async ({ req, ctx, params }) => {
  const { status } = await readJson(req, z.object({ status: z.enum(["pending", "done", "cancelled"]) }));
  return setTaskStatus(ctx, params.id, status);
});
