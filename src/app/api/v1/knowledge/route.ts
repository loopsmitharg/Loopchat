import { tenantRoute } from "@/server/http/api";
import { listKnowledge } from "@/server/services/knowledge";

export const GET = tenantRoute(async ({ ctx }) => listKnowledge(ctx));
