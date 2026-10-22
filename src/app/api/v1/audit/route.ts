import { tenantRoute } from "@/server/http/api";
import { listAudit } from "@/server/services/tenant-settings";

export const GET = tenantRoute(async ({ ctx }) => listAudit(ctx), { permission: "audit:read" });
