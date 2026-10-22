"use client";
import Link from "next/link";
import { ArrowRight, Hand, Users } from "lucide-react";
import { describeCondition, type RouteCondition } from "@/lib/team/types";
import { Badge } from "@/components/ui/badge";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { Note, SectionCard, type SectionProps } from "./shared";

type TeamLink = { id: string; name: string; status: string; isEntry: boolean; disabled: boolean; fallback: string; outgoing: { to: string; condition: RouteCondition; enabled: boolean; message: string }[]; incoming: { from: string; condition: RouteCondition; enabled: boolean }[] };

/** Transferencias: a qué bots deriva (definido en cada equipo) y la derivación a personas. */
export function TransfersSection({ bot }: SectionProps) {
  const teams = useApi<TeamLink[]>(`/api/v1/bots/${bot.id}/teams`);
  return (
    <SectionCard title="Transferencias" description="Las derivaciones entre bots se definen en cada equipo; la derivación a personas, en “Derivación humana” y “Reglas de comportamiento”.">
      <Note>
        Solo responde un bot por vez: cuando la conversación pasa a otro bot, este deja de responder (las respuestas tardías se descartan) y el que recibe continúa con el contexto. Por defecto la transferencia es silenciosa; se puede configurar un mensaje fijo en cada derivación del equipo.
      </Note>
      {teams.loading ? <SkeletonRows rows={2} /> : null}
      {teams.data?.length === 0 ? <EmptyState icon={<Users className="size-6" aria-hidden />} title="Este bot no está en ningún equipo" description="Atiende solo. Para que derive a otros bots, sumalo a un equipo de chatbots." action={<Link href="/chatbots?tab=equipos" className="text-[13px] font-medium underline">Ir a equipos</Link>} /> : null}
      <ul className="flex flex-col gap-3">
        {teams.data?.map((t) => (
          <li key={t.id} className="rounded-md border border-border p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/chatbots/equipos/${t.id}`} className="font-semibold hover:underline">
                {t.name}
              </Link>
              <Badge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Activo" : "Inactivo"}</Badge>
              {t.isEntry ? <Badge tone="brand">Recibe los mensajes nuevos</Badge> : null}
              {t.disabled ? <Badge>Deshabilitado en el equipo</Badge> : null}
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[12px] font-medium text-fg-muted">Deriva a</p>
                {t.outgoing.length ? (
                  <ul className="flex flex-col gap-1">
                    {t.outgoing.map((o, i) => (
                      <li key={i} className={o.enabled ? "" : "text-fg-muted line-through"}>
                        {o.to === "Atención humana" ? <Hand className="mr-1 inline size-3.5" aria-hidden /> : <ArrowRight className="mr-1 inline size-3.5" aria-hidden />}
                        <span className="font-medium">{o.to}</span> — {describeCondition(o.condition)}
                        {o.message ? <span className="block text-[12px] text-fg-muted">Mensaje: “{o.message}”</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-fg-muted">No deriva: atiende todo lo que recibe.</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-[12px] font-medium text-fg-muted">Recibe de</p>
                {t.incoming.length ? (
                  <ul className="flex flex-col gap-1">
                    {t.incoming.map((o, i) => (
                      <li key={i}>
                        <span className="font-medium">{o.from}</span> — {describeCondition(o.condition)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-fg-muted">{t.isEntry ? "Mensajes nuevos del número." : "Ningún bot le deriva."}</p>
                )}
              </div>
            </div>
            <p className="mt-2 text-[12px] text-fg-muted">Si un bot de destino no está disponible: {t.fallback === "entry" ? "vuelve al bot de entrada" : "pasa a una persona"}.</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
