"use client";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";

type TeamRow = { id: string; name: string; description: string; status: string; publishedVersion: number | null; botCount: number; transfers7d: number; conversations: number; updatedAt: string };

export function TeamsList({ onNew }: { onNew?: () => void }) {
  const teams = useApi<TeamRow[]>("/api/v1/teams");
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
      {teams.loading ? <SkeletonRows /> : null}
      {teams.error ? <ErrorState description={teams.error.message} onRetry={() => void teams.reload()} /> : null}
      {teams.data?.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title="Todavía no hay equipos de chatbots"
          description="Armá un equipo con una recepcionista que derive a ventas, atención al cliente o soporte. Cada bot conserva el contexto y trabaja en su pipeline."
          action={
            onNew ? (
              <Button variant="primary" onClick={onNew}>
                <Plus className="size-4" aria-hidden /> Crear equipo
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {teams.data?.length ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-fg-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">Equipo</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Estado</th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Versión</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Bots</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Derivaciones 7 d</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Editado</th>
            </tr>
          </thead>
          <tbody>
            {teams.data.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  <Link href={`/chatbots/equipos/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  {t.description ? <span className="block max-w-[340px] truncate text-[12px] text-fg-muted">{t.description}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Activo" : "Inactivo"}</Badge>
                </td>
                <td className="hidden px-4 py-2.5 tabular sm:table-cell">{t.publishedVersion ? `v${t.publishedVersion}` : "Borrador"}</td>
                <td className="px-4 py-2.5 text-right tabular">{t.botCount}</td>
                <td className="hidden px-4 py-2.5 text-right tabular md:table-cell">{t.transfers7d}</td>
                <td className="hidden px-4 py-2.5 text-right text-fg-muted md:table-cell">{formatRelative(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
