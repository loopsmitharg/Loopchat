import { tenantRoute } from "@/server/http/api";
import { addSuggestedRules } from "@/server/services/ai-profile";

export const POST = tenantRoute(async ({ ctx }) => addSuggestedRules(ctx));
