import { tenantRoute, readJson } from "@/server/http/api";
import { createTeam, listTeams, teamInputSchema } from "@/server/services/teams";

export const GET = tenantRoute(async ({ ctx }) => listTeams(ctx));
export const POST = tenantRoute(async ({ req, ctx }) => createTeam(ctx, await readJson(req, teamInputSchema)));
