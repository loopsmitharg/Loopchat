import { tenantRoute } from "@/server/http/api";
import { restoreProduct } from "@/server/services/products";

export const POST = tenantRoute(async ({ ctx, params }) => restoreProduct(ctx, params.id));
