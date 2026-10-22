import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { AiIdentitySettings } from "@/components/settings/ai-identity";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Identidad y objetivos de IA" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:read")) return <ForbiddenState />;
  return <AiIdentitySettings />;
}
