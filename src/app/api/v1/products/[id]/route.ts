import { tenantRoute, readJson } from "@/server/http/api";
import { archiveProduct, productInputSchema, updateProduct } from "@/server/services/products";

export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateProduct(ctx, params.id, await readJson(req, productInputSchema.partial())));
/** "Eliminar" archiva el producto (se conserva para el historial). */
export const DELETE = tenantRoute(async ({ ctx, params }) => archiveProduct(ctx, params.id));
