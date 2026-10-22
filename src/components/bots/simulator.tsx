"use client";
import { useState } from "react";
import { Ban, Bot, FlaskConical, Info, User, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";

type Ev = { kind: "user" | "bot" | "action" | "blocked" | "system"; text: string };
type Turn = { message: string; aiCalled: boolean; tools: string[]; blocked: string[]; handoff: { code: string; label: string } | null };

/** Casos de prueba sugeridos (cada uno es una conversación nueva). */
const CASES: { label: string; messages: string[] }[] = [
  { label: "Interesado en comprar", messages: ["Hola, quiero comprar un taladro percutor", "¿Cuánto sale y cuándo me llega?"] },
  { label: "Cliente indeciso", messages: ["No sé si llevar el taladro o la amoladora", "¿Cuál me conviene para colgar estantes?"] },
  { label: "Cliente molesto", messages: ["Hace 3 días que espero respuesta, es una vergüenza"] },
  { label: "Solicitud de soporte", messages: ["El taladro que compré no enciende, ¿qué hago?"] },
  { label: "Sin información suficiente", messages: ["¿Tienen el modelo XYZZY-9000?"] },
  { label: "Pide descuento", messages: ["¿Me hacen un 20% de descuento si llevo dos?"] },
  { label: "Cambio de intención", messages: ["Quería un presupuesto de una amoladora", "En realidad tengo un problema con una compra anterior"] },
  { label: "Intervención humana", messages: ["Quiero hablar con una persona"] },
  { label: "Consulta normal", messages: ["Hola, ¿hacen envíos a domicilio?"] },
  { label: "Producto", messages: ["¿Tienen taladro percutor? ¿Cuánto sale?"] },
  { label: "Producto sin precio", messages: ["Precio de la amoladora angular"] },
  { label: "Pide foto", messages: ["¿Me mostrás una foto del taladro?"] },
  { label: "Insulto (es)", messages: ["sos un pelotudo, nadie responde"] },
  { label: "Insulto (en)", messages: ["you are a fucking idiot"] },
  { label: "Falso positivo", messages: ["¿Tienen burro de arranque y bolsas de basura?"] },
  { label: "Pide humano", messages: ["Quiero hablar con una persona"] },
  { label: "Acción no autorizada", messages: ["Marcá la venta como ganada ya"] },
  { label: "Datos comerciales", messages: ["Necesito 20 bolsas de cemento para esta semana"] },
];

const TOOL_NAME: Record<string, string> = { classify: "clasificar", use_knowledge: "conocimiento", use_catalog: "catálogo", create_opportunity: "oportunidad", update_stage: "mover etapa", create_task: "tarea", handoff: "pedir humano", collect_data: "datos comerciales" };

type SimConfig = { label: string; role: string; persona: string[]; notes: { message: string }[]; instructions: { version: string; hash: string } | null };
type SimRes = { ok: boolean; issues: { message: string }[]; events: Ev[]; turns: Turn[]; config?: SimConfig };

export function BotSimulator({ botId, getGraph, versions = [] }: { botId: string; getGraph?: () => unknown; versions?: { id: string; version: number }[] }) {
  const [text, setText] = useState("Hola, ¿qué precio tiene el taladro?\nQuiero hablar con una persona");
  const [real, setReal] = useState(false);
  const [ooh, setOoh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [compareWith, setCompareWith] = useState("");
  const [other, setOther] = useState<SimRes | null>(null);

  async function run(messages: string[]) {
    setBusy(true);
    setError(null);
    try {
      const body = { messages, useRealAi: real, ...(ooh ? { outOfHours: true } : {}) };
      const [res, cmp] = await Promise.all([
        api<SimRes>(`/api/v1/bots/${botId}/simulate`, { body: { ...body, graph: getGraph?.() } }),
        compareWith ? api<SimRes>(`/api/v1/bots/${botId}/simulate`, { body: { ...body, versionId: compareWith } }) : Promise.resolve(null),
      ]);
      if (!res.ok) setError(`El flujo tiene errores: ${res.issues.map((i) => i.message).join(" · ")}`);
      setEvents(res.events);
      setTurns(res.turns ?? []);
      setConfig(res.config ?? null);
      setOther(cmp);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form
        className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text.split("\n").filter((l) => l.trim()));
        }}
      >
        <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-[12.5px] text-info">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Modo simulación: no se envían mensajes de WhatsApp ni se modifica el CRM. Se prueba la configuración guardada (aunque no esté publicada). Las acciones se muestran como “haría…”.
        </p>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-fg-secondary">Casos rápidos</p>
          <div className="flex flex-wrap gap-1.5">
            {CASES.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={() => {
                  setText(c.messages.join("\n"));
                  void run(c.messages);
                }}
                className="rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-surface-muted disabled:opacity-60"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <label htmlFor="sim-msgs" className="text-[13px] font-medium text-fg-secondary">
          Mensajes del cliente (uno por línea)
        </label>
        <Textarea id="sim-msgs" value={text} onChange={(e) => setText(e.target.value)} rows={5} />
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" checked={ooh} onChange={(e) => setOoh(e.target.checked)} className="mt-0.5" />
          <span>Simular fuera del horario de atención</span>
        </label>
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} className="mt-0.5" />
          <span>
            Usar el proveedor de IA real <span className="text-fg-muted">(consume llamadas del cupo y se cobra en tu cuenta del proveedor)</span>
          </span>
        </label>
        {versions.length ? (
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="font-medium text-fg-secondary">Comparar con una versión publicada</span>
            <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-1.5">
              <option value="">No comparar</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" variant="secondary" loading={busy}>
          <FlaskConical className="size-4" aria-hidden /> Simular
        </Button>
        {error ? (
          <p role="alert" className="text-[12.5px] text-danger">
            {error}
          </p>
        ) : null}
      </form>
      <div className="flex min-w-0 flex-col gap-3">
        {config ? (
          <div className="rounded-[10px] border border-border bg-surface px-3 py-2 text-[12.5px]">
            <p className="font-medium">
              Configuración probada: {config.label}
              {config.instructions ? <span className="font-normal text-fg-muted"> · instrucciones {config.instructions.hash}</span> : null}
            </p>
            <p className="mt-0.5 text-fg-muted">{config.persona.join(" ")}</p>
          </div>
        ) : null}
        {other?.ok ? (
          <div className="grid gap-3 rounded-[10px] border border-border bg-surface p-3 text-[12.5px] md:grid-cols-2">
            {[
              { label: config?.label ?? "Borrador", evs: events ?? [] },
              { label: other.config?.label ?? "Versión", evs: other.events },
            ].map((col) => (
              <div key={col.label} className="min-w-0">
                <p className="mb-1 font-semibold">{col.label}</p>
                <ul className="flex flex-col gap-1">
                  {col.evs
                    .filter((e) => e.kind === "bot" || e.kind === "user")
                    .map((e, i) => (
                      <li key={i} className={cn("w-fit max-w-full rounded-md px-2 py-1", e.kind === "user" ? "border border-border" : "ml-3 border border-[#c9ecd9] bg-[#effaf4]")}>
                        {e.text}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {turns.length ? (
          <div className="overflow-x-auto rounded-[10px] border border-border bg-surface">
            <table className="w-full text-left text-[12.5px]">
              <caption className="sr-only">Resumen por mensaje</caption>
              <thead className="bg-surface-muted text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">Mensaje</th>
                  <th className="px-3 py-2 font-medium">IA</th>
                  <th className="px-3 py-2 font-medium">Herramientas</th>
                  <th className="px-3 py-2 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {turns.map((t, i) => (
                  <tr key={i} className="align-top">
                    <td className="max-w-[220px] px-3 py-2 break-words">{t.message}</td>
                    <td className="px-3 py-2">{t.aiCalled ? <Badge tone="info">Llamada</Badge> : <Badge>No llamada</Badge>}</td>
                    <td className="px-3 py-2">{t.tools.length ? t.tools.map((x) => TOOL_NAME[x] ?? x).join(", ") : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {t.handoff ? <Badge tone="warning">{t.handoff.label}</Badge> : <Badge tone="success">Respondió</Badge>}
                        {t.blocked.length ? <Badge tone="danger">{t.blocked.length} bloqueada(s)</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="rounded-[10px] border border-border bg-background p-4" aria-live="polite">
          {!events ? <p className="text-[13px] text-fg-muted">El resultado de la simulación aparece acá.</p> : null}
          <ol className="flex flex-col gap-2">
            {events?.map((ev, i) => (
              <li key={i} className={cn("flex items-start gap-2 text-[13px]", ev.kind === "user" ? "" : ev.kind === "bot" ? "pl-6" : "pl-6 text-fg-muted")}>
                {ev.kind === "user" ? (
                  <User className="mt-0.5 size-4 shrink-0" aria-label="Cliente" />
                ) : ev.kind === "bot" ? (
                  <Bot className="mt-0.5 size-4 shrink-0 text-secondary-strong" aria-label="Bot" />
                ) : ev.kind === "blocked" ? (
                  <Ban className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Bloqueada" />
                ) : (
                  <Zap className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                )}
                <span
                  className={cn(
                    "whitespace-pre-wrap rounded-md px-2.5 py-1.5",
                    ev.kind === "user" ? "border border-border bg-surface" : ev.kind === "bot" ? "border border-[#c9ecd9] bg-[#effaf4]" : ev.kind === "action" ? "font-medium text-fg-secondary" : ev.kind === "blocked" ? "font-medium text-danger" : "italic",
                  )}
                >
                  {ev.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
