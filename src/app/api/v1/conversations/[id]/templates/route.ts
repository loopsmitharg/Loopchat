import { tenantRoute, readJson } from "@/server/http/api";
import { listTemplates, sendTemplate, sendTemplateSchema } from "@/server/services/templates";

/** Plantillas aprobadas de la WABA del número de la conversación (?sync=1 las vuelve a leer desde Meta vía Chatwoot). */
export const GET = tenantRoute(async ({ req, ctx, params }) => listTemplates(ctx, params.id, { sync: req.nextUrl.searchParams.get("sync") === "1" }), { permission: "conversation:reply", rateLimit: { max: 30 } });

export const POST = tenantRoute(async ({ req, ctx, params }) => sendTemplate(ctx, params.id, await readJson(req, sendTemplateSchema)), { permission: "conversation:reply", rateLimit: { max: 20 } });
