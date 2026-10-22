"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { api, ApiError, useApi } from "@/lib/api-client";
import { ROLE_TEMPLATES, type RoleKey } from "@/lib/team/roles";
import { INTENT_LABELS, type TeamEdge, type TeamGraph, type TeamIntent, type TeamNode } from "@/lib/team/types";

type BotOpt = { id: string; name: string; role: RoleKey; publishedVersion: number | null };
type Pipe = { id: string; name: string; isDefault: boolean };
type Choice = { mode: "new" | "existing"; botId: string; name: string; pipelineId: string };

const ROLES: RoleKey[] = ["receptionist", "sales", "customer_service", "support", "followup"];
const STEPS = ["Datos", "Roles", "Bots", "Proveedor de IA", "Pipelines", "Derivaciones", "Atención humana", "Revisar"];

/** Asistente guiado de 8 pasos para crear un equipo de chatbots sin conocer el editor. */
export function TeamWizard() {
  const router = useRouter();
  const bots = useApi<BotOpt[]>("/api/v1/bots");
  const pipes = useApi<Pipe[]>("/api/v1/pipelines");
  const conns = useApi<{ id: string; label: string; status: string }[]>("/api/v1/ai-connections");
  const channels = useApi<{ id: string; displayName: string; phoneNumber: string; status: string }[]>("/api/v1/channels");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("Equipo de atención");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState("");
  const [roles, setRoles] = useState<RoleKey[]>(["receptionist", "sales", "support"]);
  const [choices, setChoices] = useState<Partial<Record<RoleKey, Choice>>>({});
  const [conn, setConn] = useState("");
  const [cross, setCross] = useState(true);
  const [humanWords, setHumanWords] = useState("hablar con una persona, asesor, humano");
  const [unknownIntent, setUnknownIntent] = useState<"stay" | "human">("stay");
  const [maxTransfers, setMaxTransfers] = useState(3);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const choiceFor = (r: RoleKey): Choice => choices[r] ?? { mode: "new", botId: "", name: ROLE_TEMPLATES[r].label, pipelineId: "" };
  const setChoice = (r: RoleKey, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [r]: { ...choiceFor(r), ...patch } }));
  const needsAi = roles.some((r) => choiceFor(r).mode === "new");

  const preview = useMemo(() => {
    const others = roles.filter((r) => r !== "receptionist");
    const edges: { from: RoleKey; to: RoleKey; intents: TeamIntent[] }[] = [];
    const entry: RoleKey = roles.includes("receptionist") ? "receptionist" : (roles[0] ?? "sales");
    for (const r of roles) if (r !== entry) edges.push({ from: entry, to: r, intents: ROLE_TEMPLATES[r].intents });
    if (cross) for (const a of others) for (const b of others) if (a !== b && a !== entry && b !== entry) edges.push({ from: a, to: b, intents: ROLE_TEMPLATES[b].intents });
    return { entry, edges };
  }, [roles, cross]);

  if (bots.loading || pipes.loading || conns.loading) return <SkeletonRows />;
  if (bots.error) return <ErrorState description={bots.error.message} />;

  const canNext = (() => {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) return roles.length >= 2;
    if (step === 2) return roles.every((r) => (choiceFor(r).mode === "existing" ? Boolean(choiceFor(r).botId) : choiceFor(r).name.trim().length >= 2));
    if (step === 3) return !needsAi || Boolean(conn);
    return true;
  })();

  async function create() {
    setBusy(true);
    setError(null);
    const out: string[] = [];
    try {
      const botIds: Partial<Record<RoleKey, string>> = {};
      for (const r of roles) {
        const c = choiceFor(r);
        if (c.mode === "existing") {
          botIds[r] = c.botId;
          continue;
        }
        const t = ROLE_TEMPLATES[r];
        const b = await api<{ id: string }>("/api/v1/bots", {
          body: { name: c.name.trim(), role: r, mode: "instructions", instructions: t.instructions, allowedTools: t.tools, aiConnectionId: conn || null, config: { ...t.config, pipeline: { ...(t.config.pipeline ?? {}), primaryPipelineId: c.pipelineId || null } } },
        });
        botIds[r] = b.id;
        out.push(`Bot "${c.name}" creado con la plantilla ${t.label}.`);
        try {
          await api(`/api/v1/bots/${b.id}/publish`, { body: {} });
          out.push(`Bot "${c.name}" publicado (v1).`);
        } catch (e) {
          out.push(`No se pudo publicar "${c.name}": ${(e as ApiError).message}`);
        }
      }
      for (const r of roles) {
        const c = choiceFor(r);
        if (c.mode === "existing" && !bots.data?.find((b) => b.id === c.botId)?.publishedVersion) out.push(`"${bots.data?.find((b) => b.id === c.botId)?.name}" no tiene versión publicada: publicalo antes de publicar el equipo.`);
      }
      const nodeId = (r: RoleKey) => `n-${r}`;
      const specialists = roles.filter((r) => r !== preview.entry);
      const nodes: TeamNode[] = roles.map((r) => ({ id: nodeId(r), type: "bot", position: r === preview.entry ? { x: 40, y: 200 } : { x: 420, y: 20 + specialists.indexOf(r) * 260 }, data: { botId: botIds[r]! } }));
      const words = humanWords.split(",").map((w) => w.trim()).filter((w) => w.length >= 2);
      if (words.length) nodes.push({ id: "human", type: "human", position: { x: 820, y: 200 }, data: {} });
      const edges: TeamEdge[] = preview.edges
        .filter((e) => e.intents.length)
        .map((e, i) => ({ id: `e${i + 1}`, source: nodeId(e.from), target: nodeId(e.to), data: { condition: { kind: "intent" as const, intents: e.intents }, enabled: true } }));
      if (words.length) edges.push({ id: "e-human", source: nodeId(preview.entry), target: "human", data: { condition: { kind: "keywords", keywords: words }, enabled: true } });
      const graph: TeamGraph = { nodes, edges, settings: { entryNodeId: nodeId(preview.entry), unknownIntent, maxConsecutiveTransfers: maxTransfers, fallback: "entry" }, automations: [] };
      const team = await api<{ id: string }>("/api/v1/teams", { body: { name: name.trim(), description: description.trim(), channelConnectionId: channel || null, graph } });
      out.push("Equipo creado.");
      try {
        await api(`/api/v1/teams/${team.id}/publish`, { body: {} });
        out.push("Equipo publicado (v1). Activalo cuando termines de probarlo.");
      } catch (e) {
        out.push(`El equipo quedó como borrador: ${(e as ApiError).message}`);
      }
      setLog(out);
      router.push(`/chatbots/equipos/${team.id}`);
    } catch (e) {
      setLog(out);
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/chatbots?tab=equipos" className="mb-3 inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Equipos de chatbots
      </Link>
      <h1 className="font-display text-[22px] font-semibold tracking-tight">Nuevo equipo de chatbots</h1>
      <p className="mb-4 text-[13px] text-fg-muted">Te guiamos en 8 pasos. Después podés ajustar todo en el editor visual.</p>
      <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]", i === step ? "border-brand-strong bg-brand-soft font-semibold" : i < step ? "border-border text-fg-secondary" : "border-border text-fg-muted")}>
            {i < step ? <Check className="size-3" aria-hidden /> : <span className="tabular">{i + 1}.</span>} {s}
          </li>
        ))}
      </ol>

      <section className="rounded-[10px] border border-border bg-surface p-4 sm:p-5" aria-labelledby="wizard-step">
        <h2 id="wizard-step" className="mb-3 text-[15px] font-semibold">
          {step + 1}. {STEPS[step]}
        </h2>

        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <Field label="Nombre del equipo">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
            <Field label="Descripción (opcional)">{(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}</Field>
            <Field label="Número de WhatsApp" hint="Vacío = todos los números de la empresa. Un equipo activo atiende antes que un bot individual del mismo número.">
              {(p) => (
                <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Todos los números</option>
                  {(channels.data ?? [])
                    .filter((c) => c.status !== "disconnected")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName} ({c.phoneNumber})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] text-fg-secondary">¿Qué tipos de consulta recibís? Elegí al menos dos roles. La recepcionista recibe al cliente y lo deriva.</legend>
            {ROLES.map((r) => {
              const on = roles.includes(r);
              return (
                <label key={r} className={cn("flex cursor-pointer items-start gap-2 rounded-[10px] border p-3", on ? "border-brand-strong bg-brand-soft/40" : "border-border")}>
                  <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => setRoles((x) => (e.target.checked ? ROLES.filter((y) => y === r || x.includes(y)) : x.filter((y) => y !== r)))} />
                  <span>
                    <span className="block text-[13.5px] font-semibold">{ROLE_TEMPLATES[r].label}</span>
                    <span className="block text-[12.5px] text-fg-secondary">{ROLE_TEMPLATES[r].short}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-fg-secondary">Para cada rol, creá un bot nuevo con la plantilla (instrucciones distintas por rol, editables) o usá uno que ya tengas.</p>
            {roles.map((r) => {
              const c = choiceFor(r);
              const existing = bots.data ?? [];
              return (
                <div key={r} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="text-[13.5px] font-semibold">{ROLE_TEMPLATES[r].label}</span>
                  <Select aria-label={`Bot para ${ROLE_TEMPLATES[r].label}`} value={c.mode} onChange={(e) => setChoice(r, { mode: e.target.value as Choice["mode"] })}>
                    <option value="new">Crear bot nuevo con plantilla</option>
                    <option value="existing" disabled={!existing.length}>
                      Usar un bot existente
                    </option>
                  </Select>
                  {c.mode === "new" ? (
                    <Input aria-label={`Nombre del bot ${ROLE_TEMPLATES[r].label}`} value={c.name} onChange={(e) => setChoice(r, { name: e.target.value })} maxLength={60} />
                  ) : (
                    <Select aria-label={`Bot existente para ${ROLE_TEMPLATES[r].label}`} value={c.botId} onChange={(e) => setChoice(r, { botId: e.target.value })}>
                      <option value="">Elegí un bot…</option>
                      {existing
                        .filter((b) => !roles.some((o) => o !== r && choiceFor(o).mode === "existing" && choiceFor(o).botId === b.id))
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({ROLE_TEMPLATES[b.role]?.label ?? b.role}){b.publishedVersion ? "" : " — sin publicar"}
                          </option>
                        ))}
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {step === 3 ? (
          needsAi ? (
            conns.data?.length ? (
              <Field label="Proveedor de IA para los bots nuevos" hint="Se usa la API key de tu empresa. La derivación entre bots se hace primero sin IA.">
                {(p) => (
                  <Select {...p} value={conn} onChange={(e) => setConn(e.target.value)}>
                    <option value="">Elegí una conexión…</option>
                    {conns.data!
                      .filter((c) => c.status !== "revoked")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : (
              <p className="rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
                No hay una conexión de IA. Cargá la clave de tu proveedor en{" "}
                <Link href="/configuracion/ia" className="font-medium underline">
                  Configuración → IA
                </Link>{" "}
                o usá solo bots existentes.
              </p>
            )
          ) : (
            <p className="text-[13px] text-fg-secondary">Todos los bots ya existen: usan el proveedor de IA que tengan configurado.</p>
          )
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-fg-secondary">Cada bot trabaja en su pipeline (por ejemplo, soporte en un pipeline de casos). La recepcionista no crea oportunidades.</p>
            {roles.map((r) => {
              const c = choiceFor(r);
              return (
                <div key={r} className="grid items-center gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <span className="text-[13.5px] font-medium">{c.mode === "new" ? c.name : (bots.data?.find((b) => b.id === c.botId)?.name ?? "—")}</span>
                  {c.mode === "new" ? (
                    <Select aria-label={`Pipeline de ${c.name}`} value={c.pipelineId} onChange={(e) => setChoice(r, { pipelineId: e.target.value })}>
                      <option value="">Pipeline principal de la empresa</option>
                      {(pipes.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[12.5px] text-fg-muted">Se configura en el bot (Configuración → Pipeline asociado).</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-fg-secondary">Así se van a pasar las conversaciones (sin IA, por la necesidad detectada). El cliente no recibe un aviso de cambio de bot.</p>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {preview.edges.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{ROLE_TEMPLATES[e.from].label}</span>
                  <ArrowRight className="size-3.5 text-fg-muted" aria-hidden />
                  <span className="font-medium">{ROLE_TEMPLATES[e.to].label}</span>
                  <span className="text-fg-muted">— {e.intents.map((x) => INTENT_LABELS[x].split(" (")[0]).join(" / ") || "sin necesidad asociada (no se crea)"}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} /> Permitir derivaciones entre los bots especialistas (por ejemplo, de Ventas a Soporte si el cliente reporta una falla)
            </label>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="flex flex-col gap-4">
            <Field label="Frases para pasar a una persona" hint="Separadas por coma. Vacío = sin derivación directa (los bots igual pueden pedir una persona).">
              {(p) => <Input {...p} value={humanWords} onChange={(e) => setHumanWords(e.target.value)} />}
            </Field>
            <Field label="Si la recepcionista no identifica la necesidad">
              {(p) => (
                <Select {...p} value={unknownIntent} onChange={(e) => setUnknownIntent(e.target.value as "stay" | "human")}>
                  <option value="stay">Pregunta al cliente y sigue</option>
                  <option value="human">Pasa a una persona</option>
                </Select>
              )}
            </Field>
            <Field label="Derivaciones seguidas sin respuesta antes de pasar a una persona">{(p) => <Input {...p} type="number" min={1} max={10} value={maxTransfers} onChange={(e) => setMaxTransfers(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />}</Field>
            <p className="flex items-start gap-2 text-[12.5px] text-fg-muted">
              <Hand className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Cuando pasa a una persona, todo el equipo deja de responder y nadie retoma la conversación automáticamente. Los insultos se detectan sin IA.
            </p>
          </div>
        ) : null}

        {step === 7 ? (
          <div className="flex flex-col gap-2 text-[13px]">
            <p>
              <span className="text-fg-muted">Equipo:</span> <span className="font-medium">{name}</span>
            </p>
            <p>
              <span className="text-fg-muted">Recibe los mensajes:</span> <span className="font-medium">{ROLE_TEMPLATES[preview.entry].label}</span>
            </p>
            <ul className="list-disc pl-5">
              {roles.map((r) => {
                const c = choiceFor(r);
                return (
                  <li key={r}>
                    {ROLE_TEMPLATES[r].label}: {c.mode === "new" ? `bot nuevo "${c.name}"` : `"${bots.data?.find((b) => b.id === c.botId)?.name}"`}
                  </li>
                );
              })}
            </ul>
            <p className="text-fg-muted">Al crear: se crean y publican los bots nuevos, se crea el equipo y se intenta publicarlo. Queda <strong>inactivo</strong> hasta que lo pruebes en el simulador y lo actives.</p>
            {log.length ? (
              <ul className="rounded-md bg-surface-muted px-3 py-2 text-[12.5px]">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : null}
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex justify-between gap-2 border-t border-border pt-4">
          <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            <ArrowLeft className="size-4" aria-hidden /> Anterior
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Siguiente <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button variant="primary" onClick={create} loading={busy}>
              <Check className="size-4" aria-hidden /> Crear equipo
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
