import { tenantRoute } from "@/server/http/api";
import { disconnectChannel } from "@/server/services/channels";

export const POST = tenantRoute(async ({ ctx, params }) => disconnectChannel(ctx, params.id), { allowWhenSuspended: true });
