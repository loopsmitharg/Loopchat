import { Suspense } from "react";
import { requirePageContext } from "@/server/authz/page";
import { listChannels } from "@/server/services/channels";
import { hasPermission } from "@/server/authz/context";
import { Inbox } from "@/components/inbox/inbox";
import { ForbiddenState, SkeletonRows } from "@/components/ui/states";

export const metadata = { title: "Conversaciones" };

export default async function ConversationsPage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "conversation:read")) return <ForbiddenState />;
  const channels = hasPermission(ctx, "settings:read") ? await listChannels(ctx) : [];
  const hasChannel = !hasPermission(ctx, "settings:read") || channels.some((c) => c.status === "connected");
  return (
    <Suspense fallback={<SkeletonRows />}>
      <Inbox hasChannel={hasChannel} />
    </Suspense>
  );
}
