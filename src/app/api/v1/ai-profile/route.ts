import { tenantRoute, readJson } from "@/server/http/api";
import { z } from "zod";
import { getAiProfile, updateAiProfile } from "@/server/services/ai-profile";

export const GET = tenantRoute(async ({ ctx }) => getAiProfile(ctx));
export const PUT = tenantRoute(async ({ req, ctx }) => updateAiProfile(ctx, await readJson(req, z.unknown())));
