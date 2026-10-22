import { requirePageContext } from "@/server/authz/page";
import { getDashboardMetrics } from "@/server/services/metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const { ctx } = await requirePageContext();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const m = await getDashboardMetrics(ctx, { from, to });
  return <DashboardView m={m} days={days} />;
}
