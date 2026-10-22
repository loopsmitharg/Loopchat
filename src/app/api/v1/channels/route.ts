import { tenantRoute, readJson } from "@/server/http/api";
import { channelSchema, connectWhatsapp, listChannels } from "@/server/services/channels";

export const GET = tenantRoute(async ({ ctx }) => listChannels(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => connectWhatsapp(ctx, await readJson(req, channelSchema)), { rateLimit: { max: 10 } });
