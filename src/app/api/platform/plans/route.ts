import { platformRoute } from "@/server/http/api";
import { listPlans } from "@/server/services/plans";

export const GET = platformRoute(async () => listPlans());
