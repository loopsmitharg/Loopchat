import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { KnowledgeSettings } from "@/components/settings/knowledge";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Conocimiento" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "knowledge:read")) return <ForbiddenState />;
  return <KnowledgeSettings />;
}
