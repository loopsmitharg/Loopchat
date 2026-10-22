import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { sendOutbound } from "@/server/services/outbound";

export const POST = tenantRoute(
  async ({ req, ctx, params }) => {
    const body = await readJson(req, z.object({ text: z.string().min(1).max(4096), idempotencyKey: z.string().min(8).max(200) }));
    return sendOutbound(ctx, { conversationId: params.id, text: body.text, idempotencyKey: `ui:${body.idempotencyKey}` });
  },
  { permission: "conversation:reply", rateLimit: { max: 40 } },
);
