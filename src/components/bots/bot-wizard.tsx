"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { EMOJI_LABELS, FORMALITY_LABELS, LENGTH_LABELS, resolveCompanyProfile, type CompanyProfile } from "@/lib/ai-profile";
import { mergeBotConfig, AI_HANDOFF_CONDITIONS, type BotConfig, type BotConfigPatch } from "@/lib/bot-config";
import { AI_TOOLS, TOOL_LABELS, type AiTool } from "@/lib/flow/types";
import { AI_HANDOFF_TEXT, ATTITUDE_LABELS, goalCatalog, SALES_LABELS } from "@/lib/instructions/catalog";
import { previewSamples, resolvePersona } from "@/lib/instructions/persona";
import { PERSONALITY_TEMPLATES, ROLE_ORDER, ROLE_TEMPLATES, type RoleKey } from "@/lib/team/roles";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { BotSimulator } from "./simulator";
import { ChoiceGroup, MultiChoice, PhraseList } from "./settings/persona-controls";

const STEPS = ["¿Qué función va a cumplir?", "¿Cuál es su objetivo?", "¿Cómo querés que hable?", "¿Qué sabe?", "¿Qué puede hacer?", "¿Cuándo debe derivar?", "Probalo", "Publicar"];
const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((v) => ({ value: v, label: labels[v] }));
type Conn = { id: string; label: string; status: string; defaultModel: string };
type Source = { id: string; title: string; status: string };
type Pipe = { id: string; name: string; isDefault: boolean };

/** Asistente de creación de un chatbot: como incorporar a un empleado virtual, sin escribir prompts. */
export function BotWizard({ editor }: { editor: "basic" | "full" }) {
  const router = useRouter();
  const toast = useToast();
  const conns = useApi<Conn[]>("/api/v1/ai-connections");
  const sources = useApi<Source[]>("/api/v1/knowledge");
  const pipes = useApi<Pipe[]>("/api/v1/pipelines");
  const profile = useApi<{ profile: CompanyProfile }>("/api/v1/ai-profile");
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<RoleKey>("sales");
  const [name, setName] = useState(ROLE_TEMPLATES.sales.label);
  const [mode, setMode] = useState<"instructions" | "flow">("instructions");
  const [cfg, setCfg] = useState<BotConfig>(() => mergeBotConfig({}, ROLE_TEMPLATES.sales.config));
  const [tools, setTools] = useState<AiTool[]>(ROLE_TEMPLATES.sales.tools);
  const [instructions, setInstructions] = useState(ROLE_TEMPLATES.sales.instructions);
  const [conn, setConn] = useState("");
  const [keywords, setKeywords] = useState(["humano", "asesor", "persona"]);
  const [botId, setBotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<number | null>(null);
  const brand = profile.data ? resolveCompanyProfile(profile.data.profile).brand : null;
  const persona = useMemo(() => resolvePersona(cfg.personality, role, brand), [cfg.personality, role, brand]);
  const patch = <K extends keyof BotConfig>(k: K, v: Partial<BotConfig[K]>) => setCfg((c) => ({ ...c, [k]: { ...c[k], ...v } }));

  function pickRole(r: RoleKey) {
    const t = ROLE_TEMPLATES[r];
    setRole(r);
    setName((n) => (ROLE_ORDER.some((x) => ROLE_TEMPLATES[x].label === n) || !n.trim() ? t.label : n));
    const base = mergeBotConfig({}, t.config);
    if (brand?.length && !t.config.personality?.length) base.personality.length = brand.length;
    setCfg(base);
    setTools(t.tools);
    setInstructions(t.instructions);
  }

  const payload = () => ({
    name: name.trim(),
    role,
    mode,
    instructions,
    allowedTools: tools,
    handoffKeywords: keywords,
    aiConnectionId: conn || null,
    config: cfg as unknown as BotConfigPatch,
  });

  async function saveDraft() {
    setBusy(true);
    try {
      if (botId) {
        const { mode: _m, ...rest } = payload();
        void _m;
        await api(`/api/v1/bots/${botId}`, { method: "PATCH", body: rest });
      } else {
        const b = await api<{ id: string }>("/api/v1/bots", { body: payload() });
        setBotId(b.id);
      }
      return true;
    } catch (e) {
      toast.push("error", (e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (step === 5 && !(await saveDraft())) return; // al pasar a "Probalo" se guarda el borrador
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  if (conns.loading || pipes.loading) return <SkeletonRows />;
  const canNext = step === 0 ? name.trim().length >= 2 : true;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/chatbots" className="mb-3 inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Chatbots
      </Link>
      <h1 className="font-display text-[22px] font-semibold tracking-tight">Nuevo chatbot</h1>
      <p className="mb-4 text-[13px] text-fg-muted">Como incorporar a un empleado virtual: le contás qué hace, cómo habla y qué puede hacer. Después podés ajustar todo desde su configuración.</p>
      <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]", i === step ? "border-brand-strong bg-brand-soft font-semibold" : i < step ? "border-border text-fg-secondary" : "border-border text-fg-muted")}>
            {i < step ? <Check className="size-3" aria-hidden /> : <span className="tabular">{i + 1}.</span>} <span className="hidden sm:inline">{s}</span>
          </li>
        ))}
      </ol>

      <section className="rounded-[10px] border border-border bg-surface p-4 sm:p-5" aria-labelledby="bot-wizard-step">
        <h2 id="bot-wizard-step" className="mb-3 text-[15px] font-semibold">
          Paso {step + 1} — {STEPS[step]}
        </h2>

        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_ORDER.map((r) => (
                <label key={r} className={cn("flex cursor-pointer items-start gap-2 rounded-[10px] border p-3", role === r ? "border-brand-strong bg-brand-soft/40" : "border-border hover:bg-surface-muted")}>
                  <input type="radio" name="role" className="mt-0.5" checked={role === r} onChange={() => pickRole(r)} />
                  <span>
                    <span className="block text-[13.5px] font-semibold">{ROLE_TEMPLATES[r].label}</span>
                    <span className="block text-[12.5px] text-fg-secondary">{ROLE_TEMPLATES[r].short}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field label="Nombre del bot">{(f) => <Input {...f} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Tipo" hint={editor === "basic" ? "Tu plan incluye el editor básico (bots por instrucciones)." : "Por instrucciones es lo más rápido; el flujo visual permite armar pasos."}>
              {(f) => (
                <Select {...f} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  <option value="instructions">Por instrucciones (recomendado)</option>
                  <option value="flow" disabled={editor !== "full"}>
                    Flujo visual
                  </option>
                </Select>
              )}
            </Field>
            <p className="text-[12px] text-fg-muted">El rol completa una plantilla editable (no es una restricción, salvo la recepcionista, que nunca vende ni crea oportunidades).</p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <Field label="Descripción de su función">{(f) => <Textarea {...f} rows={2} maxLength={400} value={cfg.identity.description} onChange={(e) => patch("identity", { description: e.target.value })} placeholder={ROLE_TEMPLATES[role].description} />}</Field>
            {goalCatalog(role).length ? (
              <MultiChoice legend="¿Qué tiene que lograr? (el primero es el principal)" value={cfg.identity.goals} options={goalCatalog(role).map((g) => ({ value: g.key, label: g.label }))} onChange={(v) => patch("identity", { goals: v })} max={10} />
            ) : null}
            <PhraseList label="Objetivos propios" value={cfg.identity.customGoals} onChange={(v) => patch("identity", { customGoals: v })} placeholder="Ej.: que el cliente agende una visita" max={10} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {PERSONALITY_TEMPLATES.map((t) => (
                <button key={t.key} type="button" onClick={() => setCfg((c) => mergeBotConfig(c, { personality: t.personality, ...(t.behavior ? { behavior: { ...t.behavior, dont: [...new Set([...c.behavior.dont, ...(t.behavior.dont ?? [])])] } } : {}) }))} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] hover:bg-surface-muted">
                  {t.label}
                </button>
              ))}
            </div>
            <ChoiceGroup legend="Formalidad" value={cfg.personality.formality} options={opts(FORMALITY_LABELS)} allowNone noneLabel={brand?.formality ? "De la marca" : "Profesional (por defecto)"} onChange={(v) => patch("personality", { formality: v })} columns={3} />
            <MultiChoice legend="Actitud (hasta 3)" value={cfg.personality.attitudes} options={opts(ATTITUDE_LABELS)} max={3} onChange={(v) => patch("personality", { attitudes: v })} />
            <div className="grid gap-4 md:grid-cols-2">
              <ChoiceGroup legend="Extensión" value={cfg.personality.length} options={opts(LENGTH_LABELS)} onChange={(v) => v && patch("personality", { length: v })} columns={2} />
              <ChoiceGroup legend="Emojis" value={cfg.personality.emojis} options={opts(EMOJI_LABELS)} onChange={(v) => v && patch("personality", { emojis: v })} columns={2} />
            </div>
            <ChoiceGroup legend="Intensidad comercial" value={cfg.personality.salesIntensity} options={opts(SALES_LABELS)} allowNone onChange={(v) => patch("personality", { salesIntensity: v })} columns={3} />
            <Field label="Trato">
              {(f) => (
                <Select {...f} value={cfg.personality.address ?? ""} onChange={(e) => patch("personality", { address: (e.target.value || null) as BotConfig["personality"]["address"] })}>
                  <option value="">Según la formalidad</option>
                  <option value="vos">Vos</option>
                  <option value="tu">Tú</option>
                  <option value="usted">Usted</option>
                </Select>
              )}
            </Field>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="mb-1 text-[12.5px] font-semibold">
                Así hablaría <span className="font-normal text-fg-muted">(ejemplo orientativo, no generado por IA)</span>
              </p>
              {previewSamples(persona, role).map((s) => (
                <p key={s.scenario} className="mt-1 w-fit max-w-full rounded-md border border-[#c9ecd9] bg-[#effaf4] px-2.5 py-1.5 text-[13px]">
                  {s.text}
                </p>
              ))}
              {persona.notes.map((n, i) => (
                <p key={i} className="mt-1 text-[12px] text-warning">
                  · {n.message}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={tools.includes("use_knowledge")} onChange={(e) => setTools((t) => (e.target.checked ? [...new Set([...t, "use_knowledge" as AiTool])] : t.filter((x) => x !== "use_knowledge")))} /> Consultar preguntas frecuentes y documentos
            </label>
            {tools.includes("use_knowledge") && (sources.data ?? []).length ? (
              <fieldset className="ml-6 flex flex-col gap-1">
                <legend className="mb-1 text-[12.5px] text-fg-secondary">Fuentes</legend>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="kmode" checked={cfg.knowledge.mode === "all"} onChange={() => patch("knowledge", { mode: "all" })} /> Todas
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="kmode" checked={cfg.knowledge.mode === "selected"} onChange={() => patch("knowledge", { mode: "selected" })} /> Solo algunas
                </label>
                {cfg.knowledge.mode === "selected"
                  ? (sources.data ?? [])
                      .filter((s) => s.status === "ready")
                      .map((s) => (
                        <label key={s.id} className="ml-5 flex items-center gap-2 text-[13px]">
                          <input type="checkbox" checked={cfg.knowledge.sourceIds.includes(s.id)} onChange={(e) => patch("knowledge", { sourceIds: e.target.checked ? [...cfg.knowledge.sourceIds, s.id] : cfg.knowledge.sourceIds.filter((x) => x !== s.id) })} /> {s.title}
                        </label>
                      ))
                  : null}
              </fieldset>
            ) : null}
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={tools.includes("use_catalog")} onChange={(e) => setTools((t) => (e.target.checked ? [...new Set([...t, "use_catalog" as AiTool])] : t.filter((x) => x !== "use_catalog")))} /> Consultar el catálogo de productos (precio, stock, fotos)
            </label>
            {tools.includes("use_catalog") ? (
              <Field label="Productos disponibles para este bot">
                {(f) => (
                  <Select {...f} value={cfg.catalog.mode} onChange={(e) => patch("catalog", { mode: e.target.value as BotConfig["catalog"]["mode"] })}>
                    <option value="all">Todo el catálogo activo</option>
                    <option value="selected">Solo los que asocie después (sección Productos)</option>
                  </Select>
                )}
              </Field>
            ) : null}
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={cfg.memory.enabled} onChange={(e) => patch("memory", { enabled: e.target.checked })} /> Memoria comercial del CRM (oportunidades, tareas y productos consultados del cliente)
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            {conns.data?.length ? (
              <Field label="Proveedor de IA" hint="Se usa la API key de tu empresa.">
                {(f) => (
                  <Select {...f} value={conn} onChange={(e) => setConn(e.target.value)}>
                    <option value="">Elegí una conexión…</option>
                    {conns.data!
                      .filter((c) => c.status !== "revoked")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} · {c.defaultModel}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : (
              <p className="rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
                No hay una conexión de IA. Podés crear el bot igual y cargarla en{" "}
                <Link href="/configuracion/ia" className="underline">
                  Configuración → IA
                </Link>{" "}
                antes de publicarlo.
              </p>
            )}
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Acciones permitidas (validadas en el servidor)</legend>
              {AI_TOOLS.filter((t) => t !== "use_knowledge" && t !== "use_catalog").map((t) => {
                const blocked = role === "receptionist" && (t === "create_opportunity" || t === "update_stage");
                return (
                  <label key={t} className={cn("flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]", blocked && "opacity-60")}>
                    <input type="checkbox" disabled={blocked} checked={tools.includes(t) && !blocked} onChange={(e) => setTools((x) => (e.target.checked ? [...new Set([...x, t])] : x.filter((y) => y !== t)))} />
                    {TOOL_LABELS[t]}
                    {blocked ? <span className="text-[11.5px] text-fg-muted">(no para recepcionista)</span> : null}
                  </label>
                );
              })}
            </fieldset>
            {(tools.includes("create_opportunity") || tools.includes("update_stage")) && role !== "receptionist" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Pipeline principal">
                  {(f) => (
                    <Select {...f} value={cfg.pipeline.primaryPipelineId ?? ""} onChange={(e) => patch("pipeline", { primaryPipelineId: e.target.value || null })}>
                      <option value="">Principal de la empresa</option>
                      {(pipes.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="¿Cuándo crea oportunidades?">
                  {(f) => (
                    <Select {...f} value={cfg.pipeline.createOpportunity} onChange={(e) => patch("pipeline", { createOpportunity: e.target.value as BotConfig["pipeline"]["createOpportunity"] })}>
                      <option value="purchase_intent">Solo con intención de compra</option>
                      <option value="any_inquiry">Ante cualquier consulta</option>
                      <option value="never">Nunca</option>
                    </Select>
                  )}
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-4">
            <PhraseList label="Palabras que piden una persona (sin IA)" value={keywords} onChange={setKeywords} placeholder="Ej.: humano" max={20} maxLength={40} />
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={cfg.handoff.insultDetection} onChange={(e) => patch("handoff", { insultDetection: e.target.checked })} /> Derivar ante insultos o agresiones (sin IA)
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={tools.includes("handoff")} onChange={(e) => setTools((t) => (e.target.checked ? [...new Set([...t, "handoff" as AiTool])] : t.filter((x) => x !== "handoff")))} /> La IA puede pedir una persona
            </label>
            {tools.includes("handoff") ? <MultiChoice legend="Además, cuando…" value={cfg.behavior.handoffWhen} options={AI_HANDOFF_CONDITIONS.map((k) => ({ value: k, label: AI_HANDOFF_TEXT[k].label }))} onChange={(v) => patch("behavior", { handoffWhen: v })} /> : null}
            <Field label="Mensaje al derivar (opcional, sin IA)">{(f) => <Input {...f} maxLength={500} value={cfg.handoff.transferMessage} onChange={(e) => patch("handoff", { transferMessage: e.target.value })} placeholder="Voy a derivar tu conversación a una persona de nuestro equipo." />}</Field>
            <p className="text-[12px] text-fg-muted">Las derivaciones a otros bots se arman en un equipo de chatbots. Al seguir, se guarda el bot como borrador para probarlo.</p>
          </div>
        ) : null}

        {step === 6 && botId ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-fg-secondary">Probalo con el simulador: no envía mensajes ni cambia el CRM.</p>
            <BotSimulator botId={botId} />
          </div>
        ) : null}

        {step === 7 && botId ? (
          <div className="flex flex-col gap-3 text-[13px]">
            <p>
              Al publicar se valida la configuración y se crea la versión 1 (inmutable). Después podés activarlo para que atienda mensajes reales, o sumarlo a un equipo.
            </p>
            {published ? (
              <p className="rounded-md border border-[#abefc6] bg-success-soft px-3 py-2 text-success">Versión {published} publicada.</p>
            ) : (
              <Button
                variant="primary"
                className="self-start"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ version: number }>(`/api/v1/bots/${botId}/publish`, { body: {} });
                    setPublished(r.version);
                  } catch (e) {
                    toast.push("error", (e as ApiError).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Rocket className="size-4" aria-hidden /> Validar y publicar
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push(`/chatbots/${botId}`)}>Ir a la configuración del bot</Button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-between gap-2 border-t border-border pt-4">
          <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            <ArrowLeft className="size-4" aria-hidden /> Anterior
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next} disabled={!canNext} loading={busy}>
              {step === 5 ? "Guardar y probar" : "Siguiente"} <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </section>
      <details className="mt-4 rounded-md border border-border bg-surface">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">Instrucciones particulares (avanzado, opcional)</summary>
        <div className="px-3 pb-3">
          <Textarea aria-label="Instrucciones particulares" rows={6} maxLength={8000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
      </details>
    </div>
  );
}
