import { asc, eq } from "drizzle-orm";
import { requirePageContext } from "@/server/authz/page";
import { hasPermission } from "@/server/authz/context";
import { db } from "@/server/db";
import { pipelines, stages, tenants } from "@/server/db/schema";
import { BotDetail } from "@/components/bots/bot-detail";
import { ForbiddenState } from "@/components/ui/states";

export const metadata = { title: "Bot" };

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePageContext();
  if (!hasPermission(ctx, "bot:read")) return <ForbiddenState />;
  const { id } = await params;
  const st = await db
    .select({ id: stages.id, name: stages.name, kind: stages.kind, pipelineName: pipelines.name })
    .from(stages)
    .innerJoin(pipelines, eq(pipelines.id, stages.pipelineId))
    .where(eq(stages.tenantId, ctx.tenantId))
    .orderBy(asc(pipelines.position), asc(stages.position));
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  const bh = tenant?.settings?.businessHours;
  const companyHours = { enabled: Boolean(bh?.enabled), summary: bh?.enabled ? `${(bh.days ?? []).map((d) => DAYS[d]).join(", ")} de ${bh.start} a ${bh.end}` : "", message: tenant?.settings?.outOfHoursMessage ?? "" };
  const multiPipeline = new Set(st.map((s) => s.pipelineName)).size > 1;
  return <BotDetail id={id} stages={st.map((s) => ({ ...s, pipelineName: multiPipeline ? s.pipelineName : undefined }))} companyHours={companyHours} />;
}
