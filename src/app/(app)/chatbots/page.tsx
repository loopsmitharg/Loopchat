import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { BotsList } from "@/components/bots/bots-list";
import { ForbiddenState, SkeletonRows } from "@/components/ui/states";
import { Suspense } from "react";

export const metadata = { title: "Chatbots" };

export default async function BotsPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:read")) return <ForbiddenState />;
  return (
    <Suspense fallback={<SkeletonRows />}>
      <BotsList />
    </Suspense>
  );
}
