import { tenantRoute } from "@/server/http/api";
import { republishOutdatedBots } from "@/server/services/bots";

export const POST = tenantRoute(async ({ ctx }) => republishOutdatedBots(ctx));
