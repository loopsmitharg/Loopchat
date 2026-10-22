import { platformRoute } from "@/server/http/api";
import { platformOverview } from "@/server/services/ops";

export const GET = platformRoute(async () => platformOverview());
