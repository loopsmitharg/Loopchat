import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { getUsageSummary } from "@/server/services/usage";
import { PlanView } from "@/components/settings/plan";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Plan y consumo" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "usage:read")) return <ForbiddenState />;
  return <PlanView u={await getUsageSummary(ctx.tenantId)} />;
}
