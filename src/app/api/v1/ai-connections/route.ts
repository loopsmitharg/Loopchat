import { tenantRoute, readJson } from "@/server/http/api";
import { createAiConnection, createAiConnectionSchema, listAiConnections } from "@/server/services/ai-connections";

export const GET = tenantRoute(async ({ ctx }) => listAiConnections(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createAiConnection(ctx, await readJson(req, createAiConnectionSchema)), { rateLimit: { max: 10 } });
