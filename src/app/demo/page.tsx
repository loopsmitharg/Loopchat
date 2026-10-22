import { notFound } from "next/navigation";
import { AlertTriangle, Bot, PauseCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { LoopchatLogo } from "@/components/ui/logo";
import { EmptyState, ErrorState, ForbiddenState, OfflineBanner, SkeletonRows } from "@/components/ui/states";
import { DemoThread } from "@/components/inbox/demo-thread";
import type { ThreadMessage } from "@/components/inbox/types";

export const metadata = { title: "DEMO · Sistema visual" };
export const dynamic = "force-dynamic";

const now = Date.parse("2026-10-20T14:00:00-03:00");
const m = (i: number, p: Partial<ThreadMessage>): ThreadMessage => ({ key: `d${i}`, localId: `l${i}`, chatwootId: i, direction: "out", senderKind: "agent", authorName: "Carla (DEMO)", content: "", createdAt: new Date(now + i * 60000).toISOString(), status: "sent", error: null, isTemplate: false, attachments: [], origin: null, retryable: false, ...p });
const demoThread: ThreadMessage[] = [
  m(1, { direction: "in", senderKind: "contact", authorName: "Cliente DEMO", content: "Hola, ¿tienen taladro percutor de 750 W?", status: null }),
  m(2, { senderKind: "bot", authorName: "Bot", content: "¡Hola! Sí, el taladro percutor 750 W está a $85.000 (DEMO). ¿Querés que te lo reserve?", status: "read" }),
  m(3, { direction: "in", senderKind: "contact", authorName: "Cliente DEMO", content: "Quiero hablar con una persona", status: null }),
  m(4, { content: "Hola, soy Carla. Te lo reservo hasta mañana.", status: "delivered" }),
  m(5, { content: "Te paso el link de pago.", status: "pending" }),
  m(6, { content: "Mensaje que no se pudo entregar", status: "failed", error: "Recipient not on WhatsApp (DEMO)", retryable: true, chatwootId: null }),
];

/** Vista de diseño con datos ficticios rotulados DEMO. Deshabilitada salvo LOOPCHAT_DEMO_MODE=true. */
export default function DemoPage() {
  if (process.env.LOOPCHAT_DEMO_MODE !== "true" || process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#fedf89] bg-warning-soft px-4 py-2 text-[13px] text-warning">
        <AlertTriangle className="size-4" aria-hidden /> <strong>DEMO</strong> — vista de diseño con datos ficticios. No está conectada al backend.
      </div>
      <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
        <LoopchatLogo />
        <Panel title="Botones y estados">
          <div className="flex flex-wrap gap-2 p-4">
            <Button variant="primary">Acción principal</Button>
            <Button variant="secondary">Secundaria</Button>
            <Button>Contorno</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="danger">Peligrosa</Button>
            <Button loading>Guardando</Button>
            <Button disabled>Deshabilitado</Button>
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            <Badge tone="success" icon={<Bot className="size-3" aria-hidden />}>Bot</Badge>
            <Badge tone="warning" icon={<PauseCircle className="size-3" aria-hidden />}>Bot pausado</Badge>
            <Badge>Humano</Badge>
            <Badge tone="danger">Cupo agotado</Badge>
            <Badge tone="info">Simulación</Badge>
            <Badge tone="brand">En uso</Badge>
          </div>
        </Panel>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Hilo (envío en curso, entregado, leído, fallido)">
            <DemoThread messages={demoThread} />
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="Cargando">
              <SkeletonRows rows={3} />
            </Panel>
            <Panel title="Vacío">
              <EmptyState title="No hay conversaciones con estos filtros" description="Cuando un cliente escriba a tu número, aparece acá." />
            </Panel>
            <Panel title="Error">
              <ErrorState description="Chatwoot no responde. Reintentá en unos segundos." />
            </Panel>
            <Panel title="Sin permiso">
              <ForbiddenState />
            </Panel>
            <Panel title="Sin conexión">
              <OfflineBanner />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
