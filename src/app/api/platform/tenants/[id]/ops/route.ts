import { platformRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { reprocessFailedEvents, requestReconcile } from "@/server/services/ops";

export const POST = platformRoute(async ({ req, user, params }) => {
  const { action } = await readJson(req, z.object({ action: z.enum(["reprocess_failed", "reconcile"]) }));
  if (action === "reprocess_failed") return reprocessFailedEvents(params.id, user.id);
  await requestReconcile(params.id, user.id);
  return { ok: true };
});
