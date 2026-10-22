import { platformRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { linkChatwootAccountManually, linkManualSchema, provisionChatwootAccount } from "@/server/services/chatwoot-provisioning";

export const POST = platformRoute(async ({ req, user, params }) => {
  const body = await readJson(req, z.object({ mode: z.enum(["provision", "link"]), link: linkManualSchema.optional() }));
  if (body.mode === "link") return linkChatwootAccountManually(params.id, body.link!, user.id);
  return provisionChatwootAccount(params.id, user.id);
});
