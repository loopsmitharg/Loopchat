import { eq } from "drizzle-orm";
import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { db } from "@/server/db";
import { chatwootAccounts } from "@/server/db/schema";
import { WhatsappSettings } from "@/components/settings/whatsapp";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "WhatsApp" };
export default async function Page() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "settings:read")) return <ForbiddenState />;
  const cw = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, ctx.tenantId) });
  return <WhatsappSettings chatwootReady={Boolean(cw)} />;
}
