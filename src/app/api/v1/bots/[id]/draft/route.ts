import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { saveDraft } from "@/server/services/bots";

export const PUT = tenantRoute(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ graph: z.unknown(), revision: z.number().int().min(0) }));
  return saveDraft(ctx, params.id, { graph: body.graph, revision: body.revision });
}, { rateLimit: { max: 120 } });
