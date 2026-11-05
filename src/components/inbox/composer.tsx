"use client";
import { useRef, useState } from "react";
import { FileText, Lock, MessageSquareText, Send, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { api, ApiError } from "@/lib/api-client";
import { TemplateDialog } from "./template-dialog";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Composer({
  conversationId,
  replyDisabledReason,
  canNote,
  attentionMode,
  templateAllowed = false,
  onSent,
  onError,
}: {
  conversationId: string;
  replyDisabledReason: string | null;
  /** Ventana de 24 h cerrada pero el usuario puede responder: se ofrece enviar una plantilla aprobada. */
  templateAllowed?: boolean;
  canNote: boolean;
  attentionMode: "bot" | "requested" | "human" | "paused";
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"message" | "note">(replyDisabledReason && canNote ? "note" : "message");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const keyRef = useRef<string>(newKey());
  const disabledReason =
    mode === "message" ? replyDisabledReason : !canNote ? "Tu rol no permite agregar notas." : null;

  async function submit() {
    const body = text.trim();
    if (!body || sending || disabledReason) return;
    setSending(true);
    try {
      if (mode === "message") await api(`/api/v1/conversations/${conversationId}/messages`, { body: { text: body, idempotencyKey: keyRef.current } });
      else await api(`/api/v1/conversations/${conversationId}/notes`, { body: { body } });
      setText("");
      keyRef.current = newKey();
      onSent();
    } catch (e) {
      const err = e as ApiError;
      onError(err.message);
      // si el mensaje quedó registrado como fallido, el reintento se hace desde el hilo
      if (err.code === "upstream_error") {
        setText("");
        keyRef.current = newKey();
        onSent();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("border-t border-border bg-surface px-3 py-2.5 sm:px-4", mode === "note" && "bg-warning-soft/60")}>
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Tipo de mensaje">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "message"}
          onClick={() => setMode("message")}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] font-medium", mode === "message" ? "bg-surface-sunken text-fg" : "text-fg-muted hover:text-fg")}
        >
          <MessageSquareText className="size-3.5" aria-hidden /> Responder por WhatsApp
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "note"}
          onClick={() => setMode("note")}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] font-medium", mode === "note" ? "bg-[#fdeccb] text-warning" : "text-fg-muted hover:text-fg")}
        >
          <StickyNote className="size-3.5" aria-hidden /> Nota interna
        </button>
        {mode === "message" && (attentionMode === "bot" || attentionMode === "requested") && !disabledReason ? (
          <span className="ml-auto hidden text-right text-[11.5px] text-fg-muted 2xl:inline">{attentionMode === "requested" ? "El cliente espera a una persona: al responder tomás la conversación." : "Al responder tomás el control y el bot se pausa."}</span>
        ) : null}
        {mode === "note" ? <span className="ml-auto hidden text-right text-[11.5px] text-warning sm:inline">Solo la ve tu equipo. Nunca se envía al cliente.</span> : null}
      </div>
      {disabledReason ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-[12.5px] text-fg-secondary" role="status">
          <Lock className="size-3.5 shrink-0" aria-hidden /> <span className="min-w-0 flex-1">{disabledReason}</span>
          {mode === "message" && templateAllowed ? (
            <Button size="sm" variant="primary" onClick={() => setTemplateOpen(true)}>
              <FileText className="size-3.5" aria-hidden /> Enviar plantilla
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor="composer">
            {mode === "message" ? "Mensaje para el cliente" : "Nota interna"}
          </label>
          <textarea
            id="composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={4096}
            placeholder={mode === "message" ? "Escribí una respuesta… (Enter envía, Shift+Enter nueva línea)" : "Escribí una nota para el equipo…"}
            className="max-h-40 min-h-[44px] flex-1 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-brand/45"
          />
          <Button type="submit" variant={mode === "message" ? "primary" : "outline"} loading={sending} disabled={!text.trim()} aria-label={mode === "message" ? "Enviar mensaje" : "Guardar nota"}>
            <Send className="size-4" aria-hidden />
            <span className="hidden sm:inline">{mode === "message" ? "Enviar" : "Guardar nota"}</span>
          </Button>
        </form>
      )}
      {templateAllowed ? <TemplateDialog conversationId={conversationId} open={templateOpen} onClose={() => setTemplateOpen(false)} onSent={onSent} onError={onError} /> : null}
    </div>
  );
}
