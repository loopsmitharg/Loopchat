"use client";
import { useState } from "react";
import { ArrowRight, Ban, Bot, FlaskConical, Info, RotateCcw, Send, User, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_TEMPLATES, type RoleKey } from "@/lib/team/roles";
import { INTENT_LABELS, type TeamGraph, type TeamIntent } from "@/lib/team/types";

type Ev = { kind: "user" | "bot" | "action" | "blocked" | "system"; text: string };
type Turn = {
  message: string;
  aiCalled: boolean;
  tools: string[];
  blocked: string[];
  handoff: { code: string; label: string } | null;
  activeBot: { id: string; name: string; role: RoleKey } | null;
  previousBot: { id: string; name: string } | null;
  intent: TeamIntent | null;
  signals: string[];
  transfer: { reason: string; kind: string }[];
  routeAi: boolean;
  pipeline: string | null;
  stage: string | null;
  actions: string[];
  tokens: number;
  eventsFrom: number;
  eventsTo: number;
};

const CASES: { label: string; messages: string[] }[] = [
  { label: "Venta", messages: ["Hola", "¿Cuánto sale el taladro percutor?"] },
  { label: "Reclamo con precio", messages: ["Compré una amoladora y dejó de funcionar, ¿cuánto sale arreglarla?"] },
  { label: "Ventas → soporte", messages: ["Quiero comprar una sierra", "Ah, y el taladro que compré no enciende"] },
  { label: "Pedido demorado", messages: ["Mi pedido no llegó todavía"] },
  { label: "Pide persona", messages: ["Quiero hablar con una persona"] },
  { label: "Insulto", messages: ["sos un inútil, nadie responde"] },
];

const TOOL_NAME: Record<string, string> = { classify: "clasificar", use_knowledge: "conocimiento", use_catalog: "catálogo", create_opportunity: "oportunidad", update_stage: "mover etapa", create_task: "tarea", handoff: "pedir humano", collect_data: "datos comerciales" };

/** Simulador multiagente: chat a la izquierda, actividad del equipo a la derecha. Nada real cambia. */
export function TeamSimulator({ teamId, getGraph }: { teamId: string; getGraph: () => TeamGraph }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [real, setReal] = useState(false);
  const [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<Ev[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(msgs: string[]) {
    if (!msgs.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; issues: { message: string }[]; events: Ev[]; turns: Turn[] }>(`/api/v1/teams/${teamId}/simulate`, { body: { messages: msgs, useRealAi: real, graph: getGraph(), botSource: drafts ? "draft" : "published" } });
      if (!res.ok) {
        setError(`El equipo tiene errores: ${res.issues.map((i) => i.message).join(" · ")}`);
        return;
      }
      setMessages(msgs);
      setEvents(res.events);
      setTurns(res.turns);
      setSel(res.turns.length - 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const t = sel !== null ? turns[sel] : undefined;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-[12.5px] text-info">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Simulación del equipo: no se envían mensajes ni se modifica el CRM (las oportunidades son simuladas). Se usa el borrador del equipo; los bots usan su versión publicada salvo que elijas sus borradores.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-medium text-fg-secondary">Casos rápidos:</span>
        {CASES.map((c) => (
          <button key={c.label} type="button" disabled={busy} onClick={() => void run(c.messages)} className="rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-surface-muted disabled:opacity-60">
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section aria-label="Chat de prueba" className="flex min-h-[420px] min-w-0 flex-col rounded-[10px] border border-border bg-background">
          <ol className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
            {!turns.length ? <li className="text-[13px] text-fg-muted">Escribí como si fueras el cliente. Cada mensaje muestra qué bot respondió y por qué.</li> : null}
            {turns.map((turn, i) => {
              const evs = events.slice(turn.eventsFrom, turn.eventsTo);
              return (
                <li key={i}>
                  <button type="button" onClick={() => setSel(i)} className={cn("flex w-full flex-col gap-1.5 rounded-md p-1 text-left", sel === i && "bg-brand-soft/50 ring-1 ring-brand")} aria-pressed={sel === i} aria-label={`Ver actividad del mensaje ${i + 1}`}>
                    {evs
                      .filter((e) => e.kind === "user" || e.kind === "bot")
                      .map((e, k) => (
                        <span key={k} className={cn("flex items-start gap-2 text-[13px]", e.kind === "bot" && "pl-6")}>
                          {e.kind === "user" ? <User className="mt-0.5 size-4 shrink-0" aria-label="Cliente" /> : <Bot className="mt-0.5 size-4 shrink-0" aria-label="Bot" />}
                          <span className={cn("min-w-0 whitespace-pre-wrap rounded-md px-2.5 py-1.5", e.kind === "user" ? "border border-border bg-surface" : "border border-[#c9ecd9] bg-[#effaf4]")}>
                            {e.kind === "bot" && turn.activeBot ? <span className="mb-0.5 block text-[11px] font-semibold text-fg-muted">{turn.activeBot.name}</span> : null}
                            {e.text}
                          </span>
                        </span>
                      ))}
                    {turn.transfer.length ? (
                      <span className="pl-6 text-[11.5px] text-fg-muted">
                        <ArrowRight className="inline size-3" aria-hidden /> {turn.transfer.map((x) => x.reason).join(" · ")}
                      </span>
                    ) : null}
                    {turn.handoff ? (
                      <span className="pl-6">
                        <Badge tone="warning">Pasa a una persona · {turn.handoff.label}</Badge>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <form
            className="flex flex-col gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || messages.length >= 12) return;
              const next = [...messages, text.trim()];
              setText("");
              void run(next);
            }}
          >
            <div className="flex gap-2">
              <label htmlFor="team-sim-input" className="sr-only">
                Mensaje del cliente
              </label>
              <Input id="team-sim-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={messages.length >= 12 ? "Máximo 12 mensajes por prueba" : "Escribí un mensaje del cliente…"} disabled={busy || messages.length >= 12} maxLength={1000} className="min-w-0 flex-1" />
              <Button type="submit" variant="secondary" loading={busy} aria-label="Enviar mensaje de prueba">
                <Send className="size-4" aria-hidden />
              </Button>
              <Button
                onClick={() => {
                  setMessages([]);
                  setTurns([]);
                  setEvents([]);
                  setSel(null);
                }}
                aria-label="Reiniciar conversación de prueba"
                disabled={busy}
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Usar los borradores de los bots
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> IA real <span className="text-fg-muted">(consume el cupo)</span>
              </label>
            </div>
            {error ? (
              <p role="alert" className="text-[12.5px] text-danger">
                {error}
              </p>
            ) : null}
          </form>
        </section>

        <aside aria-label="Actividad del equipo" className="min-w-0 rounded-[10px] border border-border bg-surface p-4 text-[13px]">
          <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
            <FlaskConical className="size-4" aria-hidden /> Actividad {t ? `· mensaje ${sel! + 1}` : ""}
          </h3>
          {!t ? (
            <p className="text-fg-muted">Elegí un mensaje del chat para ver qué pasó.</p>
          ) : (
            <dl className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-3 gap-y-2">
              <dt className="text-fg-muted">Bot activo</dt>
              <dd className="min-w-0">
                {t.activeBot ? (
                  <>
                    <span className="font-medium">{t.activeBot.name}</span> <span className="text-fg-muted">({ROLE_TEMPLATES[t.activeBot.role]?.label ?? t.activeBot.role})</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-fg-muted">Bot anterior</dt>
              <dd>{t.previousBot?.name ?? "—"}</dd>
              <dt className="text-fg-muted">Necesidad</dt>
              <dd>
                {t.intent ? INTENT_LABELS[t.intent].split(" (")[0] : "No identificada"}
                {t.signals.length ? <span className="block text-[12px] text-fg-muted">Señales: {t.signals.join(", ")}</span> : null}
              </dd>
              <dt className="text-fg-muted">Derivación</dt>
              <dd className="min-w-0 break-words">{t.transfer.length ? t.transfer.map((x) => x.reason).join(" → ") : "Sin derivación"}</dd>
              <dt className="text-fg-muted">IA</dt>
              <dd>
                {t.aiCalled ? <Badge tone="info">Llamada{t.routeAi ? " (clasificación + respuesta)" : ""}</Badge> : <Badge>No llamada</Badge>}
                {t.tokens ? <span className="ml-1 text-[12px] text-fg-muted tabular">{t.tokens} tokens</span> : null}
              </dd>
              <dt className="text-fg-muted">Herramientas</dt>
              <dd>{t.tools.length ? t.tools.map((x) => TOOL_NAME[x] ?? x).join(", ") : "—"}</dd>
              <dt className="text-fg-muted">Pipeline</dt>
              <dd>{t.pipeline ?? "—"}</dd>
              <dt className="text-fg-muted">Etapa (simulada)</dt>
              <dd>{t.stage ?? "Sin oportunidad"}</dd>
              <dt className="text-fg-muted">Acciones</dt>
              <dd className="min-w-0">
                {t.actions.length ? (
                  <ul className="flex flex-col gap-0.5">
                    {t.actions.map((a, k) => (
                      <li key={k}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-fg-muted">Bloqueado</dt>
              <dd className="min-w-0 text-danger">{t.blocked.length ? t.blocked.join(" · ") : <span className="text-fg-muted">—</span>}</dd>
              <dt className="text-fg-muted">Resultado</dt>
              <dd>{t.handoff ? <Badge tone="warning">{t.handoff.label}</Badge> : <Badge tone="success">Respondió</Badge>}</dd>
            </dl>
          )}
          {t ? (
            <details className="mt-3 border-t border-border pt-2">
              <summary className="cursor-pointer text-[12.5px] font-medium text-fg-secondary">Registro detallado</summary>
              <ol className="mt-2 flex flex-col gap-1">
                {events
                  .slice(t.eventsFrom, t.eventsTo)
                  .filter((e) => e.kind !== "user" && e.kind !== "bot")
                  .map((e, k) => (
                    <li key={k} className={cn("flex items-start gap-1.5 text-[12.5px]", e.kind === "blocked" ? "text-danger" : "text-fg-secondary")}>
                      {e.kind === "blocked" ? <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Zap className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                      <span className="min-w-0 break-words">{e.text}</span>
                    </li>
                  ))}
              </ol>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
