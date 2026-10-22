import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Panel, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatDuration, formatMoney, formatNumber } from "@/lib/format";
import { LIMIT_LABELS } from "@/lib/plans";
import type { getDashboardMetrics } from "@/server/services/metrics";

type M = Awaited<ReturnType<typeof getDashboardMetrics>>;

function Stat({ label, value, hint, href, alert }: { label: string; value: string | number; hint?: string; href?: string; alert?: boolean }) {
  const inner = (
    <>
      <span className="text-[12.5px] text-fg-muted">{label}</span>
      <span className={cn("font-display text-[26px] font-semibold leading-tight tabular", alert ? "text-danger" : "text-fg")}>{value}</span>
      {hint ? <span className="text-[12px] text-fg-muted">{hint}</span> : null}
    </>
  );
  const cls = "flex flex-col gap-0.5 rounded-[10px] border border-border bg-surface px-4 py-3";
  return href ? (
    <Link href={href} className={cn(cls, "group hover:border-border-strong")}>
      {inner}
      <span className="mt-1 inline-flex items-center gap-1 text-[12px] text-fg-secondary group-hover:text-fg">
        Ver <ArrowRight className="size-3" aria-hidden />
      </span>
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular">
          {formatNumber(used)} / {limit === null ? "uso justo" : formatNumber(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken" role="meter" aria-valuemin={0} aria-valuemax={limit ?? used} aria-valuenow={used} aria-label={label}>
        <div className={cn("h-1.5 rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-[#d97706]" : "bg-brand-strong")} style={{ width: `${limit ? pct : 0}%` }} />
      </div>
    </div>
  );
}

export function DashboardView({ m, days }: { m: M; days: number }) {
  const maxStage = Math.max(1, ...m.pipeline.map((s) => s.count));
  const p = m.pending;
  const limits = m.usage.plan.limits;
  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Dashboard"
        description={`Últimos ${days} días · datos de tu empresa`}
        actions={
          <nav aria-label="Período" className="flex gap-1 rounded-md border border-border bg-surface p-0.5 text-[12.5px]">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/dashboard?dias=${d}`} aria-current={d === days ? "page" : undefined} className={cn("rounded px-2.5 py-1", d === days ? "bg-ink text-white" : "text-fg-secondary hover:bg-surface-muted")}>
                {d} días
              </Link>
            ))}
          </nav>
        }
      />

      <h2 className="sr-only">Pendientes</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Sin responsable (atención humana)" value={p?.unassigned ?? 0} href="/conversaciones?" alert={(p?.unassigned ?? 0) > 0} />
        <Stat label="Tareas vencidas" value={p?.overdue_tasks ?? 0} href="/tareas" alert={(p?.overdue_tasks ?? 0) > 0} />
        <Stat label="Seguimientos vencidos" value={p?.follow_ups_due ?? 0} href="/pipeline" alert={(p?.follow_ups_due ?? 0) > 0} />
        <Stat label="Mensajes fallidos (7 días)" value={p?.failed_messages ?? 0} hint="Reintentalos desde la conversación" alert={(p?.failed_messages ?? 0) > 0} />
        <Stat label="Eventos sin sincronizar" value={p?.failed_events ?? 0} hint={(p?.failed_events ?? 0) > 0 ? "Avisá a Loop Smiths" : "Sincronización al día"} alert={(p?.failed_events ?? 0) > 0} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Conversaciones" className="lg:col-span-1">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[13px]">
            <div>
              <dt className="text-fg-muted">Nuevas en el período</dt>
              <dd className="text-[20px] font-semibold tabular">{m.conversations.incoming}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Atendidas</dt>
              <dd className="text-[20px] font-semibold tabular">{m.conversations.attended}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Primera respuesta (mediana)</dt>
              <dd className="text-[20px] font-semibold tabular">{formatDuration(m.firstResponse.medianSeconds)}</dd>
              <dd className="text-[11.5px] text-fg-muted">{m.firstResponse.samples} conversaciones medidas</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Abiertas ahora</dt>
              <dd className="text-[20px] font-semibold tabular">{m.conversations.byStatus.open ?? 0}</dd>
              <dd className="text-[11.5px] text-fg-muted">
                Bot {m.conversations.byMode.bot ?? 0} · Humano {m.conversations.byMode.human ?? 0} · Pausado {m.conversations.byMode.paused ?? 0}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Pipeline principal" description="Oportunidades por etapa (todas las fechas)" className="lg:col-span-2">
          {m.pipeline.length === 0 ? (
            <p className="p-4 text-[13px] text-fg-muted">Sin etapas configuradas.</p>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {m.pipeline.map((s) => (
                <li key={s.stageId} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="truncate text-fg-secondary">{s.name}</span>
                  <span className="h-2.5 rounded-sm bg-surface-sunken">
                    <span className={cn("block h-2.5 rounded-sm", s.kind === "won" ? "bg-secondary" : s.kind === "lost" ? "bg-border-strong" : "bg-brand-strong")} style={{ width: `${(s.count / maxStage) * 100}%` }} />
                  </span>
                  <span className="text-right tabular">
                    {s.count}
                    <span className="ml-2 text-fg-muted">{Object.entries(s.totals).map(([c, v]) => formatMoney(v, c)).join(" · ") || "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-[13px]">
            <span>
              Ganadas en el período: <strong className="tabular">{m.closed.won}</strong>
              {Object.entries(m.closed.wonValue).length ? <span className="text-fg-muted"> ({Object.entries(m.closed.wonValue).map(([c, v]) => formatMoney(v, c)).join(" · ")})</span> : null}
            </span>
            <span>
              Perdidas: <strong className="tabular">{m.closed.lost}</strong>
            </span>
          </div>
        </Panel>

        <Panel title="Bots" description="Ejecuciones en el período">
          <dl className="grid grid-cols-2 gap-3 p-4 text-[13px]">
            <div>
              <dt className="text-fg-muted">Ejecuciones</dt>
              <dd className="text-[20px] font-semibold tabular">{m.bots.runs}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Derivadas a humano</dt>
              <dd className="text-[20px] font-semibold tabular">
                {m.bots.handedOff}
                {m.bots.handoffRate !== null ? <span className="ml-1 text-[13px] font-normal text-fg-muted">({Math.round(m.bots.handoffRate * 100)}%)</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Completadas</dt>
              <dd className="tabular">{m.bots.completed}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Con error</dt>
              <dd className={cn("tabular", m.bots.failed ? "text-danger" : "")}>{m.bots.failed}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title={`Plan ${m.usage.plan.planName}`} description={`Consumo de ${m.usage.period}`} className="lg:col-span-2">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Meter label={LIMIT_LABELS.aiCallsPerMonth} used={m.usage.usage.aiCalls} limit={limits.aiCallsPerMonth} />
            <Meter label={LIMIT_LABELS.whatsappNumbers} used={m.usage.usage.whatsappNumbers} limit={limits.whatsappNumbers} />
            <Meter label={LIMIT_LABELS.agents} used={m.usage.usage.agents} limit={limits.agents} />
            <Meter label={LIMIT_LABELS.activeBots} used={m.usage.usage.activeBots} limit={limits.activeBots} />
            <p className="text-[12.5px] text-fg-muted sm:col-span-2">
              Mensajes del mes: {formatNumber(m.usage.usage.messagesIn)} recibidos · {formatNumber(m.usage.usage.messagesOut)} enviados. Los cargos de Meta y del proveedor de IA se facturan a las cuentas de tu empresa; Loopchat no estima montos.
            </p>
          </div>
        </Panel>
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-[12px] text-fg-muted">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {m.coverage}
      </p>
    </div>
  );
}
