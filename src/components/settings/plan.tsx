import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LIMIT_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/plans";
import { formatNumber } from "@/lib/format";
import type { getUsageSummary } from "@/server/services/usage";

type U = Awaited<ReturnType<typeof getUsageSummary>>;

export function PlanView({ u }: { u: U }) {
  const l = u.plan.limits;
  const rows: [string, number, number | null][] = [
    [LIMIT_LABELS.whatsappNumbers, u.usage.whatsappNumbers, l.whatsappNumbers],
    [LIMIT_LABELS.agents, u.usage.agents, l.agents],
    [LIMIT_LABELS.pipelines, u.usage.pipelines, l.pipelines],
    [LIMIT_LABELS.activeBots, u.usage.activeBots, l.activeBots],
    [`${LIMIT_LABELS.aiCallsPerMonth} (${u.period})`, u.usage.aiCalls, l.aiCallsPerMonth],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`Plan ${u.plan.planName}`} actions={<Badge tone={u.operational ? "success" : "danger"}>{SUBSCRIPTION_STATUS_LABELS[u.plan.subscriptionStatus]}</Badge>}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-fg-muted">
              <th scope="col" className="px-4 py-2 font-medium">Límite</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Uso</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Máximo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, used, max]) => (
              <tr key={label} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{label}</td>
                <td className={max !== null && used >= max ? "px-4 py-2 text-right font-semibold text-danger tabular" : "px-4 py-2 text-right tabular"}>{formatNumber(used)}</td>
                <td className="px-4 py-2 text-right tabular">{max === null ? "Uso justo" : formatNumber(max)}</td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2">{LIMIT_LABELS.editor}</td>
              <td className="px-4 py-2 text-right" colSpan={2}>
                {l.editor === "full" ? "Completo (flujos visuales)" : "Básico (bots por instrucciones)"}
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>
      <Panel title="Consumo del mes">
        <dl className="grid grid-cols-2 gap-3 p-4 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-fg-muted">Mensajes recibidos</dt>
            <dd className="text-[18px] font-semibold tabular">{formatNumber(u.usage.messagesIn)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Mensajes enviados</dt>
            <dd className="text-[18px] font-semibold tabular">{formatNumber(u.usage.messagesOut)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Llamadas de IA</dt>
            <dd className="text-[18px] font-semibold tabular">{formatNumber(u.usage.aiCalls)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Llamadas de IA fallidas</dt>
            <dd className="text-[18px] font-semibold tabular">{formatNumber(u.usage.aiCallFailures)}</dd>
          </div>
        </dl>
        <p className="border-t border-border px-4 py-3 text-[12.5px] text-fg-muted">
          Al llegar a un límite se bloquean solo las acciones nuevas afectadas (por ejemplo, el bot deriva a un humano si se agota el cupo de IA). El historial siempre queda disponible. Para cambiar de plan contactá a Loop Smiths. Las tarifas de Meta y del proveedor de IA se facturan directamente a tu empresa y no se estiman acá.
        </p>
      </Panel>
    </div>
  );
}
