"use client";
import { AlertTriangle, Bot, Check, CheckCheck, Clock, FileText, RotateCcw } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { formatDate, formatTime } from "@/lib/format";
import type { ThreadMessage } from "./types";

function StatusIcon({ m }: { m: ThreadMessage }) {
  if (m.direction === "in") return null;
  switch (m.status) {
    case "pending":
    case "sending":
    case "progress":
      return <Clock className="size-3.5" aria-label="Enviando" />;
    case "sent":
      return <Check className="size-3.5" aria-label="Enviado a WhatsApp" />;
    case "delivered":
      return <CheckCheck className="size-3.5" aria-label="Entregado" />;
    case "read":
      return <CheckCheck className="size-3.5 text-info" aria-label="Leído" />;
    case "failed":
      return <AlertTriangle className="size-3.5 text-danger" aria-label="Falló" />;
    default:
      return null;
  }
}

function Attachment({ a }: { a: ThreadMessage["attachments"][number] }) {
  if (!a.url) return <span className="text-[12px] text-fg-muted">[adjunto no disponible]</span>;
  const safe = /^https?:\/\//.test(a.url) ? a.url : null;
  if (!safe) return null;
  if (a.type === "image") {
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- adjuntos servidos por Chatwoot */}
        <img src={a.thumbUrl && /^https?:\/\//.test(a.thumbUrl) ? a.thumbUrl : safe} alt="Imagen adjunta" className="max-h-48 rounded-md border border-border" loading="lazy" />
      </a>
    );
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] underline-offset-2 hover:underline">
      <FileText className="size-3.5" aria-hidden /> {a.type === "audio" ? "Audio" : a.type === "video" ? "Video" : "Archivo"} adjunto
    </a>
  );
}

export function Thread({ messages, onRetry, retrying }: { messages: ThreadMessage[]; onRetry: (localId: string) => void; retrying: string | null }) {
  const days = messages.map((m) => formatDate(m.createdAt));
  return (
    <ol className="flex flex-col gap-1.5 px-3 py-4 sm:px-5" aria-label="Mensajes">
      {messages.map((m, i) => {
        const day = days[i];
        const showDay = i === 0 || day !== days[i - 1];
        const out = m.direction === "out";
        return (
          <li key={m.key} className="flex flex-col">
            {showDay ? <div className="my-2 self-center rounded-full bg-surface-sunken px-2.5 py-0.5 text-[11.5px] text-fg-muted">{day}</div> : null}
            <div className={cn("flex max-w-[85%] flex-col gap-1 sm:max-w-[72%]", out ? "self-end items-end" : "self-start items-start")}>
              {out ? (
                <span className="flex items-center gap-1 px-1 text-[11px] text-fg-muted">
                  {m.senderKind === "bot" ? <Bot className="size-3" aria-hidden /> : null}
                  {m.senderKind === "bot" ? "Bot" : (m.authorName ?? "Equipo")}
                  {m.isTemplate ? " · plantilla" : ""}
                </span>
              ) : null}
              <div
                className={cn(
                  "rounded-[10px] px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap break-words",
                  out
                    ? m.status === "failed"
                      ? "border border-[#fecdca] bg-danger-soft text-fg"
                      : m.senderKind === "bot"
                        ? "border border-[#c9ecd9] bg-[#effaf4] text-fg"
                        : "border border-[#d9f99d] bg-brand-soft text-fg"
                    : "border border-border bg-surface text-fg",
                )}
              >
                {m.attachments.length ? (
                  <div className="mb-1 flex flex-col gap-1">
                    {m.attachments.map((a) => (
                      <Attachment key={a.id} a={a} />
                    ))}
                  </div>
                ) : null}
                {m.content ?? (m.attachments.length ? null : <span className="text-fg-muted">(mensaje sin texto)</span>)}
              </div>
              <span className="flex items-center gap-1 px-1 text-[11px] text-fg-muted tabular">
                {formatTime(m.createdAt)} <StatusIcon m={m} />
              </span>
              {m.status === "failed" ? (
                <span className="flex flex-wrap items-center gap-2 px-1 text-[12px] text-danger" role="alert">
                  No se envió{m.error ? `: ${m.error}` : ""}
                  {m.retryable && m.localId ? (
                    <button type="button" onClick={() => onRetry(m.localId!)} disabled={retrying === m.localId} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                      <RotateCcw className="size-3" aria-hidden /> {retrying === m.localId ? "Reintentando…" : "Reintentar"}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
