import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { AiSettings } from "@/components/settings/ai";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Proveedores de IA" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:read")) return <ForbiddenState />;
  return <AiSettings />;
}
