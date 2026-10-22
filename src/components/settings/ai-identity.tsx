"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertCircle, Lock, Plus, Rocket, Trash2 } from "lucide-react";
import { ADDRESS_LABELS, COMPANY_GOAL_LABELS, COMPANY_GOALS, EMOJI_LABELS, FORMALITY_LABELS, LENGTH_LABELS, RULE_CATEGORIES, RULE_CATEGORY_LABELS, type CompanyGoal, type CompanyProfile, type RuleCategory } from "@/lib/ai-profile";
import { ROLE_TEMPLATES } from "@/lib/team/roles";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { ChoiceGroup, MultiChoice, PhraseList } from "@/components/bots/settings/persona-controls";
import { Note, SectionCard } from "@/components/bots/settings/shared";

type Rule = { id: string; text: string; category: RuleCategory; enabled: boolean; mandatory: boolean };
type Data = {
  profile: CompanyProfile;
  revision: number;
  company: { name: string; hours: string | null };
  rules: Rule[];
  bots: { id: string; name: string; role: string; published: boolean; disabledRuleIds: string[]; outdated: boolean }[];
};
type Tab = "identity" | "goals" | "rules" | "brand" | "bots";
const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((v) => ({ value: v, label: labels[v] }));

/** Configuración → Identidad y objetivos de IA: base común a todos los chatbots de la empresa. */
export function AiIdentitySettings() {
  const d = useApi<Data>("/api/v1/ai-profile");
  const canEdit = useCan("bot:write");
  const canMandatory = useCan("settings:write");
  const canPublish = useCan("bot:publish");
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("goals");
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  if (d.loading) return <SkeletonRows />;
  if (d.error || !d.data) return <ErrorState description={d.error?.message ?? "No se pudo cargar."} />;
  const data = d.data;
  const p = draft ?? data.profile;
  const setP = (fn: (x: CompanyProfile) => CompanyProfile) => setDraft(fn(p));
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data.profile);
  const outdated = data.bots.filter((b) => b.outdated);

  async function saveProfile() {
    setBusy(true);
    try {
      await api("/api/v1/ai-profile", { method: "PUT", body: p });
      toast.push("success", "Guardado. Los bots lo aplican cuando publicás una versión nueva (las reglas obligatorias rigen al instante).");
      setDraft(null);
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  async function call(path: string, body: unknown, ok: string, method: "POST" | "PATCH" | "DELETE" = "POST") {
    try {
      await api(path, { method, body });
      toast.push("success", ok);
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    }
  }

  const tabs: [Tab, string][] = [
    ["goals", "Objetivo"],
    ["identity", "Identidad"],
    ["rules", "Reglas generales"],
    ["brand", "Personalidad de marca"],
    ["bots", `Bots (${data.bots.length})`],
  ];
  const saveBar = canEdit ? (
    <Button variant="secondary" onClick={saveProfile} loading={busy} disabled={!dirty}>
      Guardar cambios
    </Button>
  ) : (
    <p className="text-[12.5px] text-fg-muted">Solo lectura.</p>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight">Identidad y objetivos de IA</h1>
        <p className="text-[13px] text-fg-muted">La base común de todos tus chatbots: qué es la empresa, qué busca, qué reglas se respetan siempre y cómo habla la marca. Cada bot la especializa sin perder coherencia.</p>
      </div>
      {outdated.length ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            {outdated.length} bot(s) publicados usan una versión anterior de esta configuración ({outdated.map((b) => b.name).join(", ")}). Las reglas obligatorias ya rigen; el resto se aplica al publicar.
          </span>
          {canPublish ? (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                try {
                  const r = await api<{ published: string[]; skipped: { name: string; reason: string }[] }>("/api/v1/ai-profile/apply", { body: {} });
                  toast.push(r.skipped.length ? "info" : "success", `Publicados: ${r.published.length ? r.published.join(", ") : "ninguno"}.${r.skipped.length ? ` Sin publicar: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.` : ""}`);
                  void d.reload();
                } catch (e) {
                  toast.push("error", (e as ApiError).message);
                }
              }}
            >
              <Rocket className="size-3.5" aria-hidden /> Publicar en esos bots
            </Button>
          ) : null}
        </div>
      ) : null}
      <div role="tablist" aria-label="Secciones" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap", tab === id ? "border-brand-strong text-fg" : "border-transparent text-fg-secondary hover:text-fg")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "goals" ? (
        <SectionCard title="¿Cuál es el objetivo principal de tu equipo de IA?" description="Orienta a todos los bots, pero no habilita acciones: cada bot lo aplica dentro de su función y sus permisos (soporte no vende durante un reclamo)." footer={saveBar}>
          <ChoiceGroup legend="Objetivo principal" value={p.objectives.primary} options={opts(COMPANY_GOAL_LABELS)} allowNone noneLabel="Sin definir" onChange={(v) => setP((x) => ({ ...x, objectives: { ...x.objectives, primary: v, secondary: x.objectives.secondary.filter((s) => s !== v) } }))} disabled={!canEdit} columns={3} />
          {p.objectives.primary === "custom" || p.objectives.secondary.includes("custom") ? (
            <Field label="Objetivo personalizado">{(f) => <Input {...f} maxLength={200} value={p.objectives.customGoal} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, objectives: { ...x.objectives, customGoal: e.target.value } }))} />}</Field>
          ) : null}
          <MultiChoice legend="Objetivos secundarios" value={p.objectives.secondary} options={COMPANY_GOALS.filter((g) => g !== p.objectives.primary).map((g) => ({ value: g as CompanyGoal, label: COMPANY_GOAL_LABELS[g] }))} onChange={(v) => setP((x) => ({ ...x, objectives: { ...x.objectives, secondary: v } }))} disabled={!canEdit} />
          <Field label="Explicalo con tus palabras" hint="Ejemplo: “Convertir consultas de WhatsApp en oportunidades calificadas, responder rápido y derivar a vendedores cuando el cliente está listo para comprar.”">
            {(f) => <Textarea {...f} rows={3} maxLength={600} value={p.objectives.statement} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, objectives: { ...x.objectives, statement: e.target.value } }))} />}
          </Field>
        </SectionCard>
      ) : null}

      {tab === "identity" ? (
        <SectionCard title="Identidad empresarial" description="Lo que todos los bots saben de la empresa. El nombre y los horarios se toman de Configuración → Empresa (no se duplican)." footer={saveBar}>
          <Note>
            Empresa: <strong>{data.company.name}</strong> · Horario: {data.company.hours ?? "sin horario configurado"}.{" "}
            <Link href="/configuracion/empresa" className="underline">
              Editar en Empresa
            </Link>
          </Note>
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ["description", "Descripción del negocio", 800, 3],
                ["activity", "Actividad principal", 200, 1],
                ["offering", "Productos y servicios que comercializa", 800, 3],
                ["audience", "Público objetivo", 400, 2],
                ["valueProposition", "Propuesta de valor", 400, 2],
                ["differentiators", "Diferenciales competitivos", 600, 2],
                ["coverage", "Ubicación y zona de cobertura", 300, 2],
                ["contactChannels", "Canales de contacto", 300, 2],
              ] as const
            ).map(([k, label, max, rows]) => (
              <Field key={k} label={label}>
                {(f) => (rows > 1 ? <Textarea {...f} rows={rows} maxLength={max} value={p.identity[k]} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, identity: { ...x.identity, [k]: e.target.value } }))} /> : <Input {...f} maxLength={max} value={p.identity[k]} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, identity: { ...x.identity, [k]: e.target.value } }))} />)}
              </Field>
            ))}
          </div>
          <MultiChoice legend="Idiomas de atención" value={p.identity.languages} options={[{ value: "es" as const, label: "Español" }, { value: "en" as const, label: "Inglés" }, { value: "pt" as const, label: "Portugués" }]} onChange={(v) => setP((x) => ({ ...x, identity: { ...x.identity, languages: v } }))} disabled={!canEdit} />
          <Field label="Información comercial relevante" hint="Formas de pago, envíos, garantías generales. Los precios y el stock van en Productos.">
            {(f) => <Textarea {...f} rows={3} maxLength={1000} value={p.identity.extraInfo} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, identity: { ...x.identity, extraInfo: e.target.value } }))} />}
          </Field>
        </SectionCard>
      ) : null}

      {tab === "rules" ? <RulesEditor rules={data.rules} bots={data.bots} canEdit={canEdit} canMandatory={canMandatory} call={call} /> : null}

      {tab === "brand" ? (
        <SectionCard title="Personalidad de la marca" description="Base para todos los bots. Cada bot puede especializarla (por ejemplo, soporte más técnico, ventas más proactivo). Los emojis de la marca son un máximo." footer={saveBar}>
          <Field label="Personalidad de la empresa">{(f) => <Textarea {...f} rows={2} maxLength={400} value={p.brand.personality} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, personality: e.target.value } }))} placeholder="Ej.: cercana, confiable, resolutiva; habla como un ferretero que conoce a sus clientes." />}</Field>
          <ChoiceGroup legend="Nivel de formalidad" value={p.brand.formality} options={opts(FORMALITY_LABELS)} allowNone onChange={(v) => setP((x) => ({ ...x, brand: { ...x.brand, formality: v } }))} disabled={!canEdit} columns={3} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Tratamiento de los clientes">
              {(f) => (
                <Select {...f} value={p.brand.address ?? ""} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, address: (e.target.value || null) as CompanyProfile["brand"]["address"] } }))}>
                  <option value="">Sin definir</option>
                  {opts(ADDRESS_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Uso de emojis (máximo)">
              {(f) => (
                <Select {...f} value={p.brand.emojis ?? ""} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, emojis: (e.target.value || null) as CompanyProfile["brand"]["emojis"] } }))}>
                  <option value="">Sin límite de marca</option>
                  {opts(EMOJI_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Mensajes" hint="Sugerido para bots nuevos.">
              {(f) => (
                <Select {...f} value={p.brand.length ?? ""} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, length: (e.target.value || null) as CompanyProfile["brand"]["length"] } }))}>
                  <option value="">Sin preferencia</option>
                  {opts(LENGTH_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Estilo de lenguaje">{(f) => <Input {...f} maxLength={300} value={p.brand.style} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, style: e.target.value } }))} placeholder="Ej.: claro, sin tecnicismos innecesarios" />}</Field>
          <div className="grid gap-4 md:grid-cols-2">
            <PhraseList label="Expresiones características" value={p.brand.signatureExpressions} onChange={(v) => setP((x) => ({ ...x, brand: { ...x.brand, signatureExpressions: v } }))} disabled={!canEdit} placeholder="Ej.: ¡Con gusto!" maxLength={80} />
            <PhraseList label="Expresiones que deben evitarse" value={p.brand.avoidExpressions} onChange={(v) => setP((x) => ({ ...x, brand: { ...x.brand, avoidExpressions: v } }))} disabled={!canEdit} placeholder="Ej.: barato" maxLength={80} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Forma de saludar">{(f) => <Input {...f} maxLength={200} value={p.brand.greeting} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, greeting: e.target.value } }))} placeholder="Ej.: ¡Hola! Gracias por escribir a Ferretería Norte." />}</Field>
            <Field label="Forma de despedirse">{(f) => <Input {...f} maxLength={200} value={p.brand.farewell} disabled={!canEdit} onChange={(e) => setP((x) => ({ ...x, brand: { ...x.brand, farewell: e.target.value } }))} placeholder="Ej.: ¡Gracias por elegirnos!" />}</Field>
          </div>
        </SectionCard>
      ) : null}

      {tab === "bots" ? (
        <SectionCard title="Bots de la empresa" description="Qué bots heredan esta configuración y si su versión publicada está al día.">
          <ul className="flex flex-col gap-1.5">
            {data.bots.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                <Link href={`/chatbots/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </Link>
                <span className="text-fg-muted">{ROLE_TEMPLATES[b.role as keyof typeof ROLE_TEMPLATES]?.label ?? b.role}</span>
                {!b.published ? <Badge>Sin publicar</Badge> : b.outdated ? <Badge tone="warning">Política anterior · publicar para aplicar</Badge> : <Badge tone="success">Al día</Badge>}
                {b.disabledRuleIds.length ? <span className="text-[12px] text-fg-muted">No aplica {b.disabledRuleIds.length} regla(s) común(es)</span> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}

function RulesEditor({ rules, bots, canEdit, canMandatory, call }: { rules: Rule[]; bots: Data["bots"]; canEdit: boolean; canMandatory: boolean; call: (path: string, body: unknown, ok: string, method?: "POST" | "PATCH" | "DELETE") => Promise<void> }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<RuleCategory>("other");
  const [mandatory, setMandatory] = useState(false);
  const inheritors = (r: Rule) => (r.mandatory ? bots : bots.filter((b) => !b.disabledRuleIds.includes(r.id)));
  return (
    <SectionCard title="Reglas generales de la empresa" description="Se aplican a todos los bots. Las obligatorias rigen al instante y ningún bot las puede desactivar; las demás se aplican al publicar cada bot y se pueden quitar por bot. Las validaciones de seguridad del sistema prevalecen siempre.">
      {!rules.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-fg-muted">Todavía no hay reglas.</p>
          {canMandatory ? (
            <Button size="sm" onClick={() => call("/api/v1/ai-rules/suggested", {}, "Reglas sugeridas agregadas: revisalas.")}>
              <Plus className="size-3.5" aria-hidden /> Agregar reglas sugeridas
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {RULE_CATEGORIES.filter((c) => rules.some((r) => r.category === c)).map((c) => (
          <li key={c}>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">{RULE_CATEGORY_LABELS[c]}</p>
            <ul className="flex flex-col gap-1.5">
              {rules
                .filter((r) => r.category === c)
                .map((r) => {
                  const canThis = canEdit && (!r.mandatory || canMandatory);
                  return (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]", r.enabled ? "border-border" : "border-dashed border-border opacity-70")}>
                      {r.mandatory ? <Lock className="size-3.5 shrink-0 text-warning" aria-label="Obligatoria" /> : null}
                      <span className="min-w-0 flex-1 break-words">{r.text}</span>
                      <span className="text-[12px] text-fg-muted" title={inheritors(r).map((b) => b.name).join(", ")}>
                        La heredan {inheritors(r).length} bot(s)
                      </span>
                      <label className="flex items-center gap-1 text-[12.5px]">
                        <input type="checkbox" checked={r.mandatory} disabled={!canEdit || !canMandatory} onChange={(e) => call(`/api/v1/ai-rules/${r.id}`, { mandatory: e.target.checked }, e.target.checked ? "Regla obligatoria: rige al instante en todos los bots." : "La regla dejó de ser obligatoria.", "PATCH")} />
                        Obligatoria
                      </label>
                      <label className="flex items-center gap-1 text-[12.5px]">
                        <input type="checkbox" checked={r.enabled} disabled={!canThis} onChange={(e) => call(`/api/v1/ai-rules/${r.id}`, { enabled: e.target.checked }, e.target.checked ? "Regla activada." : "Regla desactivada.", "PATCH")} />
                        Activa
                      </label>
                      {canThis ? (
                        <button
                          type="button"
                          aria-label={`Editar regla: ${r.text}`}
                          className="text-[12.5px] underline"
                          onClick={() => {
                            const t = window.prompt("Editar regla", r.text);
                            if (t && t.trim() !== r.text) void call(`/api/v1/ai-rules/${r.id}`, { text: t.trim() }, "Regla actualizada.", "PATCH");
                          }}
                        >
                          Editar
                        </button>
                      ) : null}
                      {canThis ? (
                        <button type="button" aria-label={`Eliminar regla: ${r.text}`} onClick={() => window.confirm("¿Eliminar esta regla?") && void call(`/api/v1/ai-rules/${r.id}`, undefined, "Regla eliminada.", "DELETE")} className="rounded p-1 text-fg-muted hover:bg-surface-muted hover:text-danger">
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 5) return;
            void call("/api/v1/ai-rules", { text: text.trim(), category, mandatory }, mandatory ? "Regla obligatoria creada: rige al instante." : "Regla creada: se aplica al publicar cada bot.").then(() => {
              setText("");
              setMandatory(false);
            });
          }}
        >
          <p className="text-[13px] font-medium text-fg-secondary">Nueva regla</p>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_200px]">
            <Input aria-label="Texto de la regla" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Ej.: No ofrecer descuentos sin autorización." />
            <Select aria-label="Categoría" value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)}>
              {RULE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {RULE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={mandatory} disabled={!canMandatory} onChange={(e) => setMandatory(e.target.checked)} /> Obligatoria {canMandatory ? "" : "(solo administradores)"}
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={text.trim().length < 5}>
              <Plus className="size-3.5" aria-hidden /> Agregar regla
            </Button>
          </div>
        </form>
      ) : null}
    </SectionCard>
  );
}
