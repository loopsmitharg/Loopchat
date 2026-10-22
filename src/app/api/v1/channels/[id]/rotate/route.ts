import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { rotateChannelToken } from "@/server/services/channels";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { accessToken } = await readJson(req, z.object({ accessToken: z.string().min(20).max(1000) }));
  return rotateChannelToken(ctx, params.id, accessToken);
}, { rateLimit: { max: 10 } });
