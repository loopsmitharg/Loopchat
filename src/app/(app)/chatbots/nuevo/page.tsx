import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { getPlanState } from "@/server/services/usage";
import { BotWizard } from "@/components/bots/bot-wizard";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Nuevo chatbot" };

export default async function NewBotPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:write")) return <ForbiddenState />;
  const plan = await getPlanState(ctx.tenantId);
  return <BotWizard editor={plan.limits.editor} />;
}
