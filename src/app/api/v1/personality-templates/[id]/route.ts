import { tenantRoute } from "@/server/http/api";
import { deleteTemplate } from "@/server/services/ai-profile";

export const DELETE = tenantRoute(async ({ ctx, params }) => deleteTemplate(ctx, params.id));
