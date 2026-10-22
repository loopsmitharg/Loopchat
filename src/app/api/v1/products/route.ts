import { tenantRoute, readJson } from "@/server/http/api";
import { createProduct, listProducts, productInputSchema } from "@/server/services/products";

export const GET = tenantRoute(async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  return listProducts(ctx, { q: sp.get("q") ?? undefined, availability: (sp.get("availability") ?? undefined) as never, status: (sp.get("status") ?? undefined) as never });
});
export const POST = tenantRoute(async ({ req, ctx }) => createProduct(ctx, await readJson(req, productInputSchema)), { rateLimit: { max: 120 } });
