import { z } from "zod";
import { tenantRoute, readJson } from "@/server/http/api";
import { simulateTeam } from "@/server/services/simulate-team";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const body = await readJson(
    req,
    z.object({ messages: z.array(z.string().max(1000)).min(1).max(12), useRealAi: z.boolean().optional(), graph: z.unknown().optional(), botSource: z.enum(["published", "draft"]).optional(), outOfHours: z.boolean().optional() }),
  );
  return simulateTeam(ctx, params.id, body);
}, { rateLimit: { max: 30 } });
