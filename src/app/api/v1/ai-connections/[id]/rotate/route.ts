import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { rotateAiKey } from "@/server/services/ai-connections";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { apiKey } = await readJson(req, z.object({ apiKey: z.string().min(10).max(400) }));
  return rotateAiKey(ctx, params.id, apiKey);
}, { rateLimit: { max: 10 } });
