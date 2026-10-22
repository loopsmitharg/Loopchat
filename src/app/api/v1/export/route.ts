import { tenantRoute } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";
import { exportTenantData } from "@/server/services/export";

export const GET = tenantRoute(async ({ req, ctx }) => {
  const type = req.nextUrl.searchParams.get("type");
  if (type !== "contacts" && type !== "opportunities") throw badRequest("Tipo de exportación inválido.");
  const csv = await exportTenantData(ctx, type);
  const name = `loopchat-${type === "contacts" ? "contactos" : "oportunidades"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}, { rateLimit: { max: 10 } });
