import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { addNote } from "@/server/services/notes";

export const POST = tenantRoute(async ({ req, ctx, params }) => {
  const { body } = await readJson(req, z.object({ body: z.string().min(1).max(4000) }));
  return addNote(ctx, { conversationId: params.id, body });
});
