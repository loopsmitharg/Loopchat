import { tenantRoute, readJson } from "@/server/http/api";
import { getTenantSettings, tenantSettingsSchema, updateTenantSettings } from "@/server/services/tenant-settings";

export const GET = tenantRoute(async ({ ctx }) => getTenantSettings(ctx));
export const PATCH = tenantRoute(async ({ req, ctx }) => updateTenantSettings(ctx, await readJson(req, tenantSettingsSchema)));
