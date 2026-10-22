"use client";
import { Panel } from "@/components/ui/card";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type Row = { id: string; action: string; actorKind: string; actorName: string | null; targetType: string | null; createdAt: string };

export function AuditView() {
  const d = useApi<Row[]>("/api/v1/audit");
  return (
    <Panel title="Auditoría" description="Últimas 100 acciones críticas (credenciales, miembros, bots, plan).">
      {d.loading ? <SkeletonRows /> : null}
      {d.data?.length === 0 ? <EmptyState title="Sin registros" /> : null}
      <ul className="divide-y divide-border">
        {d.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap gap-2 px-4 py-2 text-[13px]">
            <code className="text-[12px]">{r.action}</code>
            <span className="text-fg-muted">
              {r.actorKind === "user" ? (r.actorName ?? "—") : r.actorKind === "platform" ? "Loop Smiths" : r.actorKind === "bot" ? "Bot" : "Sistema"} · {formatDateTime(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
