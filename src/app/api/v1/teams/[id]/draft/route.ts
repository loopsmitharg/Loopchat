import { z } from "zod";
import { tenantRoute, readJson } from "@/server/http/api";
import { saveTeamDraft } from "@/server/services/teams";

export const PUT = tenantRoute(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ graph: z.unknown(), revision: z.number().int().min(0) }));
  return saveTeamDraft(ctx, params.id, body);
}, { rateLimit: { max: 120 } });
