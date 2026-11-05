import { tenantRoute, readJson } from "@/server/http/api";
import { updateMember, updateMemberSchema } from "@/server/services/members";
import { assertOperational } from "@/server/services/usage";

export const PATCH = tenantRoute(
  async ({ req, ctx, params }) => {
    const data = await readJson(req, updateMemberSchema);
    // con la empresa suspendida solo se permite deshabilitar usuarios (resguardo), no otros cambios
    const onlyDisable = data.status === "disabled" && Object.keys(data).every((k) => k === "status");
    if (!onlyDisable) await assertOperational(ctx.tenantId);
    await updateMember(ctx, params.id, data);
    return { ok: true };
  },
  { allowWhenSuspended: true },
);
