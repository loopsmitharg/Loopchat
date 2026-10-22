import { platformRoute } from "@/server/http/api";
import { checkHealth } from "@/server/services/ops";

export const GET = platformRoute(async () => checkHealth());
