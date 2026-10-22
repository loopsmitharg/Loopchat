import { z } from "zod";
import { tenantRoute, readJson } from "@/server/http/api";
import { listBotProductIds, setBotProducts } from "@/server/services/products";

export const GET = tenantRoute(async ({ ctx, params }) => ({ productIds: await listBotProductIds(ctx, params.id) }));
export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ add: z.array(z.string().uuid()).max(1000).optional(), remove: z.array(z.string().uuid()).max(1000).optional() }));
  return { productIds: await setBotProducts(ctx, params.id, body) };
});
