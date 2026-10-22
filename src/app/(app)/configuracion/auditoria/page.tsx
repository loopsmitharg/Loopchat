import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { AuditView } from "@/components/settings/audit";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Auditoría" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "audit:read")) return <ForbiddenState />;
  return <AuditView />;
}
