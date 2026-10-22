import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { TeamWizard } from "@/components/bots/teams/team-wizard";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Nuevo equipo de chatbots" };

export default async function NewTeamPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:write")) return <ForbiddenState />;
  return <TeamWizard />;
}
