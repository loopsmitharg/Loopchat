import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { TeamDetail } from "@/components/bots/teams/team-detail";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Equipo de chatbots" };

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:read")) return <ForbiddenState />;
  const { id } = await params;
  return <TeamDetail id={id} />;
}
