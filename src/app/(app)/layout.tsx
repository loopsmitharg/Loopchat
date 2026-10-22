import { requirePageContext } from "@/server/authz/page";
import { getPlanState, isOperational } from "@/server/services/usage";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ctx, membership, memberships, isPlatformAdmin } = await requirePageContext();
  const plan = await getPlanState(ctx.tenantId);
  return (
    <AppShell
      session={{
        user,
        tenant: { id: membership.tenantId, name: membership.tenantName, status: membership.tenantStatus },
        role: membership.role,
        memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenantName })),
        isPlatformAdmin,
        operational: isOperational(plan),
        planName: plan.planName,
        subscriptionStatus: plan.subscriptionStatus,
      }}
    >
      {children}
    </AppShell>
  );
}
