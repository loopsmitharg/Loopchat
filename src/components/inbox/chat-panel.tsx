"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, CheckCircle2, Clock, Hand, Info, PanelRightOpen, PauseCircle, RotateCcw, ShieldAlert, UserCheck, UserMinus, Users } from "lucide-react";
import { useCan, useSession } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { Composer } from "./composer";
import { HANDOFF_LABEL, MODE_LABEL, STATUS_LABEL } from "./labels";
import { Thread } from "./thread";
import type { ConvDetail, Member } from "./types";

export function ChatPanel({
  detail,
  loading,
  error,
  members,
  onBack,
  onToggleContext,
  onChanged,
}: {
  detail: ConvDetail | null;
  loading: boolean;
  error: string | null;
  members: Member[];
  onBack: () => void;
  onToggleContext: () => void;
  onChanged: () => void;
}) {
  const session = useSession();
  const toast = useToast();
  const canReply = useCan("conversation:reply");
  const canNote = useCan("conversation:note");
  const canAssignAny = useCan("conversation:assign_any");
  const canAssignSelf = useCan("conversation:assign_self");
  const canBot = useCan("conversation:bot_control");
  const canStatus = useCan("conversation:status");
  const [retrying, setRetrying] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastKey = detail?.thread.at(-1)?.key;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastKey, detail?.conversation.id]);

  if (loading && !detail) return <SkeletonRows rows={5} />;
  if (error && !detail) return <ErrorState description={error} onRetry={onChanged} />;
  if (!detail) return null;
  const conv = detail.conversation;
  const me = session.user.id;
  const assignedToOther = Boolean(conv.assigneeUserId && conv.assigneeUserId !== me);
  const agentBlocked = session.role === "agent" && assignedToOther;

  async function act(path: string, body: unknown, ok: string) {
    try {
      await api(path, { body });
      toast.push("success", ok);
      onChanged();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <button type="button" onClick={onBack} className="rounded p-1 hover:bg-surface-muted lg:hidden" aria-label="Volver a la lista">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-[180px] flex-1 basis-[220px]">
          <h2 className="truncate text-[15px] font-semibold">{detail.contact?.name ?? "Contacto"}</h2>
          <p className="truncate text-[12px] text-fg-muted tabular">
            {formatPhone(detail.contact?.phoneE164)} · {STATUS_LABEL[conv.status]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={conv.attentionMode === "bot" ? "success" : conv.attentionMode === "paused" || conv.attentionMode === "requested" ? "warning" : "neutral"} icon={conv.attentionMode === "bot" ? <Bot className="size-3" aria-hidden /> : conv.attentionMode === "paused" ? <PauseCircle className="size-3" aria-hidden /> : conv.attentionMode === "requested" ? <Hand className="size-3" aria-hidden /> : undefined}>
            {MODE_LABEL[conv.attentionMode]}
          </Badge>
          {detail.team ? (
            <span className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[11.5px] text-fg-secondary" title={`Equipo "${detail.team.name}" (v${detail.team.version}). El bot activo es quien responde; el responsable es la persona a cargo.`}>
              <Users className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {detail.team.name} · Bot activo: <span className="font-medium text-fg">{detail.team.activeBot?.name ?? "—"}</span>
              </span>
            </span>
          ) : null}
          {canBot ? (
            conv.attentionMode === "requested" && !agentBlocked ? (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  // tomar: queda a cargo de una persona (y asignada a mí si no tiene responsable)
                  if (!conv.assigneeUserId && (canAssignSelf || canAssignAny)) await api(`/api/v1/conversations/${conv.id}/assign`, { body: { assigneeUserId: me, expectedVersion: conv.version } }).catch(() => undefined);
                  await act(`/api/v1/conversations/${conv.id}/attention`, { mode: "human", reason: "Un vendedor tomó la conversación" }, "Tomaste la conversación: el bot no va a responder.");
                }}
              >
                <Hand className="size-3.5" aria-hidden /> Tomar conversación
              </Button>
            ) : conv.attentionMode === "bot" ? (
              <Button size="sm" variant="outline" onClick={() => act(`/api/v1/conversations/${conv.id}/attention`, { mode: "paused" }, "Bot pausado en esta conversación.")}>
                <PauseCircle className="size-3.5" aria-hidden /> Pausar bot
              </Button>
            ) : detail.team ? (
              <ResumeTeam team={detail.team} onResume={(botId) => act(`/api/v1/conversations/${conv.id}/attention`, { mode: "bot", botId }, "Equipo de chatbots reanudado.")} />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm("¿Reanudar el bot en esta conversación? Va a responder automáticamente los próximos mensajes.")) {
                    void act(`/api/v1/conversations/${conv.id}/attention`, { mode: "bot" }, "Bot reanudado.");
                  }
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden /> Reanudar bot
              </Button>
            )
          ) : null}
          {canAssignAny ? (
            <label className="flex items-center gap-1 text-[12.5px]">
              <span className="sr-only">Responsable</span>
              <select
                value={conv.assigneeUserId ?? ""}
                onChange={(e) => act(`/api/v1/conversations/${conv.id}/assign`, { assigneeUserId: e.target.value || null, expectedVersion: conv.version }, "Responsable actualizado.")}
                className="h-8 max-w-[160px] rounded-md border border-border-strong bg-surface px-1.5"
              >
                <option value="">Sin responsable</option>
                {members
                  .filter((m) => m.status === "active" && m.role !== "viewer")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : canAssignSelf ? (
            conv.assigneeUserId === me ? (
              <Button size="sm" variant="ghost" onClick={() => act(`/api/v1/conversations/${conv.id}/assign`, { assigneeUserId: null }, "Liberaste la conversación.")}>
                <UserMinus className="size-3.5" aria-hidden /> Liberar
              </Button>
            ) : !conv.assigneeUserId ? (
              <Button size="sm" variant="outline" onClick={() => act(`/api/v1/conversations/${conv.id}/assign`, { assigneeUserId: me }, "Tomaste la conversación.")}>
                <UserCheck className="size-3.5" aria-hidden /> Tomar
              </Button>
            ) : (
              <span className="text-[12px] text-fg-muted">Resp.: {conv.assigneeName}</span>
            )
          ) : null}
          {canStatus ? (
            conv.status === "resolved" ? (
              <Button size="sm" variant="ghost" onClick={() => act(`/api/v1/conversations/${conv.id}/status`, { status: "open" }, "Conversación reabierta.")}>
                Reabrir
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => act(`/api/v1/conversations/${conv.id}/status`, { status: "resolved" }, "Conversación resuelta.")}>
                <CheckCircle2 className="size-3.5" aria-hidden /> Resolver
              </Button>
            )
          ) : null}
          <button type="button" onClick={onToggleContext} className="rounded p-1.5 hover:bg-surface-muted" aria-label="Ver ficha del contacto y oportunidades">
            <PanelRightOpen className="size-4.5" />
          </button>
        </div>
      </header>

      <div className={cn("flex items-center gap-2 border-b px-4 py-1.5 text-[12px]", detail.window.open ? "border-border bg-surface-muted text-fg-secondary" : "border-[#fedf89] bg-warning-soft text-warning")} role="status">
        {detail.window.open ? <Clock className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
        {detail.window.open && detail.window.closesAt ? `Ventana de respuesta de WhatsApp abierta hasta las ${formatTime(detail.window.closesAt)}` : detail.window.reason}
      </div>
      {detail.remoteError ? (
        <div role="alert" className="border-b border-[#fecdca] bg-danger-soft px-4 py-1.5 text-[12px] text-danger">
          {detail.remoteError}
        </div>
      ) : null}
      {conv.attentionMode === "requested" && detail.handoff ? (
        <div role="status" className="flex items-start gap-2 border-b border-[#fedf89] bg-warning-soft px-4 py-1.5 text-[12px] text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">El bot derivó esta conversación</span>
            {detail.handoff.code ? ` · ${HANDOFF_LABEL[detail.handoff.code] ?? detail.handoff.code}` : ""}
            {detail.handoff.reason ? ` — ${detail.handoff.reason}` : ""}. El bot no va a responder hasta que alguien lo reactive.
          </span>
        </div>
      ) : null}
      {detail.activeRun ? (
        <div className="border-b border-[#c9ecd9] bg-[#effaf4] px-4 py-1.5 text-[12px] text-secondary-strong" role="status">
          El bot está {detail.activeRun.status === "waiting" ? "esperando la respuesta del cliente" : "procesando el último mensaje"}.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-background" aria-live="polite">
        <Thread
          messages={detail.thread}
          retrying={retrying}
          onRetry={async (id) => {
            setRetrying(id);
            try {
              await api(`/api/v1/messages/${id}/retry`, { body: {} });
              toast.push("success", "Mensaje reenviado.");
            } catch (e) {
              toast.push("error", (e as ApiError).message);
            } finally {
              setRetrying(null);
              onChanged();
            }
          }}
        />
        <div ref={bottomRef} />
      </div>
      <Composer
        key={conv.id}
        conversationId={conv.id}
        replyDisabledReason={
          !canReply
            ? "Tu rol no permite responder mensajes."
            : agentBlocked
              ? `La conversación tiene otro responsable (${conv.assigneeName}). Podés dejar una nota interna.`
              : !session.operational
                ? "La cuenta está suspendida: no se pueden enviar mensajes."
                : detail.window.open
                  ? null
                  : detail.window.reason
        }
        canNote={canNote}
        attentionMode={conv.attentionMode}
        onSent={onChanged}
        onError={(m) => toast.push("error", m)}
      />
    </div>
  );
}

/** Reanudar un equipo: elegir con qué bot (por defecto, el que estaba activo). */
function ResumeTeam({ team, onResume }: { team: NonNullable<ConvDetail["team"]>; onResume: (botId: string | undefined) => void }) {
  const [botId, setBotId] = useState(team.activeBot?.id ?? team.bots[0]?.id ?? "");
  return (
    <span className="flex items-center gap-1">
      <label className="sr-only" htmlFor="resume-bot">
        Bot con el que se reanuda
      </label>
      <select id="resume-bot" value={botId} onChange={(e) => setBotId(e.target.value)} className="h-8 max-w-[150px] rounded-md border border-border-strong bg-surface px-1.5 text-[12.5px]">
        {team.bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (window.confirm("¿Reanudar el equipo de chatbots? El bot elegido va a responder los próximos mensajes.")) onResume(botId || undefined);
        }}
      >
        <RotateCcw className="size-3.5" aria-hidden /> Reanudar equipo
      </Button>
    </span>
  );
}
