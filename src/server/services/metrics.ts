import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assertCan, type Ctx } from "../authz/context";
import { getUsageSummary } from "./usage";

export type MetricsRange = { from: Date; to: Date };

export function parseRange(fromRaw?: string | null, toRaw?: string | null): MetricsRange {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return { from: new Date(Date.now() - 30 * 86400_000), to: new Date() };
  if (to.getTime() - from.getTime() > 366 * 86400_000) return { from: new Date(to.getTime() - 366 * 86400_000), to };
  return { from, to };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Métricas derivadas SOLO de datos persistidos del tenant. Cada bloque declara su cobertura.
 * Todas las consultas filtran por tenant_id (sin agregados entre empresas).
 */
export async function getDashboardMetrics(ctx: Ctx, range: MetricsRange) {
  assertCan(ctx, "dashboard:read");
  const t = ctx.tenantId;
  const { from, to } = range;
  const [convStatus, convPeriod, frt, oppStages, closed, botRuns, pending, usage] = await Promise.all([
    db.execute<{ status: string; mode: string; n: number }>(sql`
      select status, attention_mode as mode, count(*)::int as n from conversations where tenant_id = ${t} group by 1, 2`),
    db.execute<{ incoming: number; attended: number }>(sql`
      select
        (select count(*)::int from conversations c where c.tenant_id = ${t} and c.created_at between ${from} and ${to}) as incoming,
        (select count(distinct m.conversation_id)::int from messages m where m.tenant_id = ${t} and m.direction = 'out' and m.status <> 'failed' and m.created_at between ${from} and ${to}) as attended`),
    db.execute<{ secs: number }>(sql`
      select extract(epoch from (fo.first_out - fi.first_in))::float as secs
      from (select conversation_id, min(created_at) as first_in from messages where tenant_id = ${t} and direction = 'in' group by 1) fi
      join (select conversation_id, min(created_at) as first_out from messages where tenant_id = ${t} and direction = 'out' and status <> 'failed' group by 1) fo using (conversation_id)
      where fi.first_in between ${from} and ${to} and fo.first_out >= fi.first_in`),
    db.execute<{ stage_id: string; name: string; position: number; kind: string; pipeline: string; n: number; currency: string | null; total: string | null }>(sql`
      select s.id as stage_id, s.name, s.position, s.kind, p.name as pipeline, count(o.id)::int as n, o.currency, sum(o.amount)::text as total
      from stages s join pipelines p on p.id = s.pipeline_id
      left join opportunities o on o.stage_id = s.id and o.tenant_id = ${t}
      where s.tenant_id = ${t} and p.is_default
      group by s.id, s.name, s.position, s.kind, p.name, o.currency order by s.position`),
    db.execute<{ status: string; n: number; currency: string; total: string | null }>(sql`
      select status, count(*)::int as n, currency, sum(amount)::text as total from opportunities
      where tenant_id = ${t} and status in ('won','lost') and closed_at between ${from} and ${to} group by 1, 3`),
    db.execute<{ status: string; n: number }>(sql`
      select status, count(*)::int as n from flow_runs where tenant_id = ${t} and started_at between ${from} and ${to} group by 1`),
    db.execute<{ unassigned: number; overdue_tasks: number; failed_messages: number; failed_events: number; follow_ups_due: number }>(sql`
      select
        (select count(*)::int from conversations where tenant_id = ${t} and status = 'open' and assignee_user_id is null and attention_mode <> 'bot') as unassigned,
        (select count(*)::int from tasks where tenant_id = ${t} and status = 'pending' and due_at < now()) as overdue_tasks,
        (select count(*)::int from messages where tenant_id = ${t} and status = 'failed' and created_at > now() - interval '7 days') as failed_messages,
        (select count(*)::int from webhook_events where tenant_id = ${t} and status = 'failed') as failed_events,
        (select count(*)::int from opportunities where tenant_id = ${t} and status = 'open' and follow_up_at < now()) as follow_ups_due`),
    getUsageSummary(t),
  ]);
  const frtSecs = frt.rows.map((r) => Number(r.secs)).filter((x) => Number.isFinite(x));
  const runs = Object.fromEntries(botRuns.rows.map((r) => [r.status, r.n]));
  const totalRuns = botRuns.rows.reduce((a, r) => a + r.n, 0);
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    conversations: {
      byStatus: convStatus.rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + r.n }), {}),
      byMode: convStatus.rows.reduce<Record<string, number>>((acc, r) => (r.status === "resolved" ? acc : { ...acc, [r.mode]: (acc[r.mode] ?? 0) + r.n }), {}),
      incoming: convPeriod.rows[0]?.incoming ?? 0,
      attended: convPeriod.rows[0]?.attended ?? 0,
    },
    firstResponse: { samples: frtSecs.length, medianSeconds: median(frtSecs), avgSeconds: frtSecs.length ? frtSecs.reduce((a, b) => a + b, 0) / frtSecs.length : null },
    pipeline: oppStages.rows.reduce<{ stageId: string; name: string; kind: string; count: number; totals: Record<string, number> }[]>((acc, r) => {
      let s = acc.find((x) => x.stageId === r.stage_id);
      if (!s) {
        s = { stageId: r.stage_id, name: r.name, kind: r.kind, count: 0, totals: {} };
        acc.push(s);
      }
      s.count += r.n;
      if (r.currency && r.total) s.totals[r.currency] = (s.totals[r.currency] ?? 0) + Number(r.total);
      return acc;
    }, []),
    closed: {
      won: closed.rows.filter((r) => r.status === "won").reduce((a, r) => a + r.n, 0),
      lost: closed.rows.filter((r) => r.status === "lost").reduce((a, r) => a + r.n, 0),
      wonValue: closed.rows.filter((r) => r.status === "won" && r.total).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.currency]: (acc[r.currency] ?? 0) + Number(r.total) }), {}),
    },
    bots: { runs: totalRuns, completed: runs.completed ?? 0, handedOff: runs.handed_off ?? 0, failed: runs.failed ?? 0, waiting: runs.waiting ?? 0, handoffRate: totalRuns ? (runs.handed_off ?? 0) / totalRuns : null },
    pending: pending.rows[0],
    usage,
    coverage:
      "Calculado con eventos recibidos por Loopchat desde Chatwoot. Conversaciones anteriores a la conexión o eventos perdidos sin reconciliar no se incluyen. Tiempo de primera respuesta: desde el primer mensaje entrante hasta la primera respuesta enviada (bot o humano).",
  };
}
