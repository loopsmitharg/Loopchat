import { tenantRoute, readJson } from "@/server/http/api";
import { addTextSource, textSourceSchema } from "@/server/services/knowledge";

export const POST = tenantRoute(async ({ req, ctx }) => addTextSource(ctx, await readJson(req, textSourceSchema)));
