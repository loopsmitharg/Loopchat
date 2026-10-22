import { Suspense } from "react";
import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { listPipelines } from "@/server/services/pipelines";
import { PipelineBoard } from "@/components/pipeline/board";
import { ForbiddenState, SkeletonRows } from "@/components/ui/states";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "opportunity:read")) return <ForbiddenState />;
  const pipelines = await listPipelines(ctx);
  const ordered = [...pipelines].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return (
    <Suspense fallback={<SkeletonRows />}>
      <PipelineBoard pipelines={ordered.map((p) => ({ id: p.id, name: p.name }))} />
    </Suspense>
  );
}
