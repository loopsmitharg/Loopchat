import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { simulateBot } from "@/server/services/simulate";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ messages: z.array(z.string().max(1000)).min(1).max(10), useRealAi: z.boolean().optional(), graph: z.unknown().optional(), outOfHours: z.boolean().optional(), versionId: z.string().uuid().nullable().optional() }));
  return simulateBot(ctx, params.id, body);
}, { rateLimit: { max: 30 } });
