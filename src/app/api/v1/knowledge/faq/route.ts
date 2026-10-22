import { tenantRoute, readJson } from "@/server/http/api";
import { addFaq, faqSchema } from "@/server/services/knowledge";

export const POST = tenantRoute(async ({ req, ctx }) => addFaq(ctx, await readJson(req, faqSchema)));
