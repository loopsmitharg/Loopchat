import { platformRoute, readJson } from "@/server/http/api";
import { updatePlan, updatePlanSchema } from "@/server/services/plans";

export const PATCH = platformRoute(async ({ req, user, params }) => updatePlan(user.id, params.id, await readJson(req, updatePlanSchema)));
