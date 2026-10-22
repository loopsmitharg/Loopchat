import { tenantRoute, readJson } from "@/server/http/api";
import { deleteTeam, getTeam, teamUpdateSchema, updateTeam } from "@/server/services/teams";

export const GET = tenantRoute(async ({ ctx, params }) => getTeam(ctx, params.id));
export const PATCH = tenantRoute(async ({ req, ctx, params }) => updateTeam(ctx, params.id, await readJson(req, teamUpdateSchema)));
export const DELETE = tenantRoute(async ({ ctx, params }) => deleteTeam(ctx, params.id));
