"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Bot, Plus, Users } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { ROLE_TEMPLATES, type RoleKey } from "@/lib/team/roles";
import { TeamsList } from "./teams/teams-list";

type Row = { id: string; name: string; role: RoleKey; mode: string; status: string; publishedVersion: number | null; runs7d: number; handoffs7d: number; updatedAt: string };
type Conn = { id: string; label: string; status: string };

export function BotsList() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "equipos" ? "teams" : "bots";
  const bots = useApi<Row[]>(tab === "bots" ? "/api/v1/bots" : null);
  const conns = useApi<Conn[]>("/api/v1/ai-connections");
  const canWrite = useCan("bot:write");
  const [chooser, setChooser] = useState(false);
  const setTab = (t: "bots" | "teams") => router.replace(t === "teams" ? "/chatbots?tab=equipos" : "/chatbots", { scroll: false });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Chatbots"
        description="Un chatbot atiende solo; un equipo reparte las conversaciones entre varios bots especializados. Siempre pueden derivar a una persona."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setChooser(true)}>
              <Plus className="size-4" aria-hidden /> Nuevo
            </Button>
          ) : null
        }
      />
      <div role="tablist" aria-label="Tipo de atención" className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            ["bots", "Mis chatbots", Bot],
            ["teams", "Equipos de chatbots", Users],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium", tab === id ? "border-brand-strong text-fg" : "border-transparent text-fg-secondary hover:text-fg")}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      {conns.data && conns.data.length === 0 ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
          Para que un bot use IA, primero cargá la clave de tu proveedor en{" "}
          <Link href="/configuracion/ia" className="font-medium underline">
            Configuración → IA
          </Link>
          . Los flujos sin nodos de IA funcionan igual.
        </p>
      ) : null}

      {tab === "teams" ? (
        <TeamsList onNew={canWrite ? () => router.push("/chatbots/equipos/nuevo") : undefined} />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {bots.loading ? <SkeletonRows /> : null}
          {bots.error ? <ErrorState description={bots.error.message} onRetry={() => void bots.reload()} /> : null}
          {bots.data?.length === 0 ? <EmptyState title="Todavía no hay bots" description="Empezá con un bot por instrucciones: describí tu negocio y probalo en el simulador antes de activarlo." /> : null}
          {bots.data?.length ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-fg-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Bot</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Estado</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Versión</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Ejecuciones 7 d</th>
                  <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Derivadas</th>
                  <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Editado</th>
                </tr>
              </thead>
              <tbody>
                {bots.data.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                    <td className="px-4 py-2.5">
                      <Link href={`/chatbots/${b.id}`} className="font-medium hover:underline">
                        {b.name}
                      </Link>
                      <span className="block text-[12px] text-fg-muted">
                        {ROLE_TEMPLATES[b.role]?.label ?? "Personalizado"} · {b.mode === "flow" ? "Flujo visual" : "Por instrucciones"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={b.status === "active" ? "success" : "neutral"}>{b.status === "active" ? "Activo" : "Inactivo"}</Badge>
                    </td>
                    <td className="hidden px-4 py-2.5 tabular sm:table-cell">{b.publishedVersion ? `v${b.publishedVersion}` : "Borrador"}</td>
                    <td className="px-4 py-2.5 text-right tabular">{b.runs7d}</td>
                    <td className="hidden px-4 py-2.5 text-right tabular md:table-cell">{b.handoffs7d}</td>
                    <td className="hidden px-4 py-2.5 text-right text-fg-muted md:table-cell">{formatRelative(b.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}

      <Modal open={chooser} onClose={() => setChooser(false)} title="¿Qué tipo de atención querés crear?" size="lg">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setChooser(false);
              router.push("/chatbots/nuevo");
            }}
            className="flex flex-col gap-2 rounded-[10px] border border-border-strong p-4 text-left hover:border-brand-strong hover:bg-brand-soft/40 focus-visible:outline-2"
          >
            <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold">
              <Bot className="size-5" aria-hidden /> Chatbot individual
            </span>
            <span className="text-[13px] text-fg-secondary">Un solo bot atiende todas las conversaciones del número: responde, usa tu catálogo y deriva a una persona cuando hace falta.</span>
            <span className="text-[12px] text-fg-muted">Ideal para empezar o para negocios con un solo tipo de consulta. Te guiamos en 8 pasos.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setChooser(false);
              router.push("/chatbots/equipos/nuevo");
            }}
            className="flex flex-col gap-2 rounded-[10px] border border-border-strong p-4 text-left hover:border-brand-strong hover:bg-brand-soft/40 focus-visible:outline-2"
          >
            <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold">
              <Users className="size-5" aria-hidden /> Equipo de chatbots
            </span>
            <span className="text-[13px] text-fg-secondary">Una recepcionista recibe al cliente y lo pasa al bot indicado (ventas, atención, soporte…). Cada bot trabaja en su pipeline y conserva el contexto.</span>
            <span className="text-[12px] text-fg-muted">Ideal cuando tenés consultas de distinto tipo. Un asistente te guía paso a paso.</span>
          </button>
        </div>
      </Modal>

    </div>
  );
}
