"use client";
import { useMemo, useState } from "react";
import { Bot, Save, Sparkles, Wand2 } from "lucide-react";
import { ADDRESS_LABELS, EMOJI_LABELS, FORMALITY_LABELS, LENGTH_LABELS, resolveCompanyProfile, type CompanyProfile } from "@/lib/ai-profile";
import type { BotConfig } from "@/lib/bot-config";
import { ATTITUDE_LABELS, INITIATIVE_LABELS, SALES_LABELS, STYLE_LABELS } from "@/lib/instructions/catalog";
import { previewSamples, resolvePersona } from "@/lib/instructions/persona";
import { PERSONALITY_TEMPLATES } from "@/lib/team/roles";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { ChoiceGroup, MultiChoice, PhraseList } from "./persona-controls";
import { Note, SaveBar, SectionCard, Toggle, useSaveBot, type SectionProps } from "./shared";

type P = BotConfig["personality"];
type OwnTemplate = { id: string; name: string; description: string; personality: Partial<P>; behavior: Partial<BotConfig["behavior"]> | null };

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((v) => ({ value: v, label: labels[v] }));

/**
 * Personalidad y comportamiento: selectores visuales que se traducen a instrucciones reales
 * (mismo motor que el runtime). Las instrucciones particulares se conservan textualmente.
 */
export function PersonalitySection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const toast = useToast();
  const profile = useApi<{ profile: CompanyProfile }>("/api/v1/ai-profile");
  const own = useApi<OwnTemplate[]>("/api/v1/personality-templates");
  const [p, setP] = useState<P>(bot.config.personality);
  const [instructions, setInstructions] = useState(bot.instructions);
  const [real, setReal] = useState<{ text: string; busy: boolean } | null>(null);
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((x) => ({ ...x, [k]: v }));
  const brand = profile.data ? resolveCompanyProfile(profile.data.profile).brand : null;
  const persona = useMemo(() => resolvePersona(p, bot.role, brand), [p, bot.role, brand]);
  const samples = previewSamples(persona, bot.role, { displayName: bot.config.identity.showName ? bot.config.identity.displayName : "", brandGreeting: p.inheritBrand ? brand?.greeting : "" });
  const dirty = JSON.stringify(p) !== JSON.stringify(bot.config.personality) || instructions !== bot.instructions;

  function applyTemplate(t: { personality: Partial<P> }) {
    setP((x) => ({ ...x, ...t.personality }));
    toast.push("info", "Plantilla aplicada: revisá y guardá los cambios.");
  }

  async function tryReal() {
    setReal({ text: "", busy: true });
    try {
      const r = await api<{ ok: boolean; events: { kind: string; text: string }[] }>(`/api/v1/bots/${bot.id}/simulate`, { body: { messages: ["Hola, quería hacer una consulta"], useRealAi: true } });
      setReal({ text: r.events.filter((e) => e.kind === "bot").map((e) => e.text).join("\n") || "(el bot no respondió)", busy: false });
    } catch (e) {
      setReal({ text: (e as ApiError).message, busy: false });
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ instructions, config: { personality: p } });
      }}
    >
      <SectionCard
        title="Personalidad y comportamiento"
        description="Elegí cómo habla el bot sin escribir instrucciones técnicas. Cada opción se traduce a indicaciones reales para la IA (podés verlas en “Instrucciones efectivas”)."
        footer={<SaveBar canEdit={canEdit} busy={busy} dirty={dirty} />}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-fg-secondary">Plantillas (opcionales y editables)</p>
          <div className="flex flex-wrap gap-1.5">
            {PERSONALITY_TEMPLATES.map((t) => (
              <button key={t.key} type="button" disabled={!canEdit} title={t.summary.join(" · ")} onClick={() => applyTemplate(t)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12.5px] hover:bg-surface-muted disabled:opacity-60">
                <Wand2 className="size-3.5" aria-hidden /> {t.label}
              </button>
            ))}
            {(own.data ?? []).map((t) => (
              <button key={t.id} type="button" disabled={!canEdit} title={t.description} onClick={() => applyTemplate(t)} className="inline-flex items-center gap-1 rounded-full border border-brand-strong/50 bg-brand-soft/40 px-2.5 py-1 text-[12.5px] hover:bg-brand-soft disabled:opacity-60">
                <Sparkles className="size-3.5" aria-hidden /> {t.name}
              </button>
            ))}
            {canEdit ? (
              <button
                type="button"
                onClick={async () => {
                  const name = window.prompt("Nombre de la plantilla (la pueden usar los demás bots de la empresa):");
                  if (!name?.trim()) return;
                  try {
                    await api("/api/v1/personality-templates", { body: { name: name.trim(), description: "", personality: p, behavior: bot.config.behavior } });
                    toast.push("success", "Plantilla guardada.");
                    void own.reload();
                  } catch (err) {
                    toast.push("error", (err as ApiError).message);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12.5px] hover:bg-surface-muted"
              >
                <Save className="size-3.5" aria-hidden /> Guardar como plantilla
              </button>
            ) : null}
          </div>
        </div>

        {brand ? (
          <Toggle
            checked={p.inheritBrand}
            disabled={!canEdit}
            onChange={(v) => set("inheritBrand", v)}
            label="Usar la personalidad de la marca como base"
            description="Lo que no definas acá se toma de Configuración → Identidad y objetivos de IA (formalidad, trato, expresiones, saludo). Los emojis de la marca son un máximo."
          />
        ) : null}

        <ChoiceGroup legend="Formalidad" value={p.formality} options={opts(FORMALITY_LABELS)} allowNone noneLabel={p.inheritBrand && brand?.formality ? `De la marca (${FORMALITY_LABELS[brand.formality]})` : "Como antes (tono)"} onChange={(v) => set("formality", v)} disabled={!canEdit} columns={3} />
        {!p.formality && !(p.inheritBrand && brand?.formality) ? (
          <Field label="Tono (configuración anterior)" hint="Se usa mientras no elijas una formalidad.">
            {(f) => (
              <Select {...f} value={p.tone} disabled={!canEdit} onChange={(e) => set("tone", e.target.value as P["tone"])}>
                <option value="formal">Formal (usted)</option>
                <option value="professional">Profesional y cercano</option>
                <option value="informal">Informal</option>
                <option value="custom">Personalizado</option>
              </Select>
            )}
          </Field>
        ) : null}
        {p.tone === "custom" && !p.formality ? <Field label="Estilo personalizado">{(f) => <Textarea {...f} rows={2} maxLength={300} value={p.customTone} disabled={!canEdit} onChange={(e) => set("customTone", e.target.value)} />}</Field> : null}

        <MultiChoice legend="Actitud (hasta 3)" value={p.attitudes} options={opts(ATTITUDE_LABELS)} max={3} onChange={(v) => set("attitudes", v)} disabled={!canEdit} hint="Si elegís actitudes que se contradicen, se usa la primera y te lo indicamos abajo." />
        <Field label="Matiz de la actitud (opcional)">{(f) => <Input {...f} maxLength={200} value={p.attitudeNote} disabled={!canEdit} onChange={(e) => set("attitudeNote", e.target.value)} placeholder="Ej.: cálido pero sin exagerar el entusiasmo" />}</Field>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChoiceGroup legend="Extensión de respuestas" value={p.length} options={opts(LENGTH_LABELS)} onChange={(v) => v && set("length", v)} disabled={!canEdit} columns={4} />
          <ChoiceGroup legend="Uso de emojis" value={p.emojis} options={opts(EMOJI_LABELS)} onChange={(v) => v && set("emojis", v)} disabled={!canEdit} columns={4} />
        </div>
        <ChoiceGroup
          legend="Iniciativa"
          value={p.initiative}
          allowNone
          options={[
            { value: "reactive", label: INITIATIVE_LABELS.reactive, hint: "Responde lo que le preguntan" },
            { value: "consultive", label: INITIATIVE_LABELS.consultive, hint: "Hace preguntas útiles" },
            { value: "proactive", label: INITIATIVE_LABELS.proactive, hint: "Propone el siguiente paso" },
          ]}
          onChange={(v) => set("initiative", v)}
          disabled={!canEdit}
          columns={4}
        />
        <ChoiceGroup legend="Intensidad comercial" value={p.salesIntensity} allowNone options={opts(SALES_LABELS)} onChange={(v) => set("salesIntensity", v)} disabled={!canEdit} columns={3} hint="Siempre dentro de los límites de la empresa y respetando si el cliente no quiere." />
        <ChoiceGroup legend="Estilo conversacional" value={p.style} allowNone options={opts(STYLE_LABELS)} onChange={(v) => set("style", v)} disabled={!canEdit} columns={4} />

        <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
          <legend className="text-[13.5px] font-semibold">Idioma y comunicación</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Idioma principal">
              {(f) => (
                <Select {...f} value={p.language} disabled={!canEdit} onChange={(e) => set("language", e.target.value as P["language"])}>
                  <option value="es">Español</option>
                  <option value="en">Inglés</option>
                  <option value="pt">Portugués</option>
                </Select>
              )}
            </Field>
            <Field label="Trato al cliente" hint="No todos los clientes quieren el mismo nivel de informalidad.">
              {(f) => (
                <Select {...f} value={p.address ?? ""} disabled={!canEdit} onChange={(e) => set("address", (e.target.value || null) as P["address"])}>
                  <option value="">{p.inheritBrand && brand?.address ? `De la marca (${ADDRESS_LABELS[brand.address]})` : "Según la formalidad"}</option>
                  <option value="vos">Vos</option>
                  <option value="tu">Tú</option>
                  <option value="usted">Usted</option>
                </Select>
              )}
            </Field>
            <Field label="Nombre del cliente">
              {(f) => (
                <Select {...f} value={p.useCustomerName} disabled={!canEdit} onChange={(e) => set("useCustomerName", e.target.value as P["useCustomerName"])}>
                  <option value="auto">Cuando sea natural</option>
                  <option value="always">Usarlo siempre que lo sepa</option>
                  <option value="never">No usarlo</option>
                </Select>
              )}
            </Field>
            <Field label="Preguntas">
              {(f) => (
                <Select {...f} value={p.questionStyle} disabled={!canEdit} onChange={(e) => set("questionStyle", e.target.value as P["questionStyle"])}>
                  <option value="auto">Libre</option>
                  <option value="one_at_a_time">Una pregunta por mensaje</option>
                </Select>
              )}
            </Field>
          </div>
          <Toggle checked={p.matchCustomerLanguage} disabled={!canEdit} onChange={(v) => set("matchCustomerLanguage", v)} label="Responder en el idioma del cliente" description="Si el cliente escribe en otro idioma, el bot le contesta en ese idioma." />
          <div className="grid gap-4 md:grid-cols-2">
            <PhraseList label="Expresiones preferidas" value={p.preferredTerms} onChange={(v) => set("preferredTerms", v)} disabled={!canEdit} placeholder="Ej.: ¡Con gusto!" max={30} maxLength={60} />
            <PhraseList label="Palabras o expresiones prohibidas" value={p.forbiddenTerms} onChange={(v) => set("forbiddenTerms", v)} disabled={!canEdit} placeholder="Ej.: barato" max={30} maxLength={60} />
          </div>
          <Field label="Terminología del negocio (opcional)" hint="Cómo se llaman las cosas en tu rubro.">
            {(f) => <Textarea {...f} rows={2} maxLength={600} value={p.glossary} disabled={!canEdit} onChange={(e) => set("glossary", e.target.value)} placeholder="Ej.: decimos “presupuesto”, no “cotización”; “retiro en local” en vez de “pick-up”." />}
          </Field>
        </fieldset>

        <Field label="Mensaje de presentación (opcional)" hint="Texto fijo que se envía una sola vez, en el primer mensaje de cada conversación. No usa la IA.">
          {(f) => <Textarea {...f} rows={2} maxLength={500} value={p.welcomeMessage} disabled={!canEdit} onChange={(e) => set("welcomeMessage", e.target.value)} placeholder="¡Hola! Gracias por escribir a Ferretería Norte. ¿En qué te ayudamos?" />}
        </Field>

        <section aria-label="Vista previa" className="rounded-md border border-border bg-background p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Bot className="size-4" aria-hidden /> Así hablaría
            <span className="rounded bg-surface-muted px-1.5 text-[11px] font-normal text-fg-muted">Ejemplo orientativo · no generado por IA</span>
          </p>
          <ul className="flex flex-col gap-2">
            {samples.map((s) => (
              <li key={s.scenario} className="text-[13px]">
                <span className="text-[11.5px] text-fg-muted">{s.scenario}</span>
                <span className="mt-0.5 block w-fit max-w-full rounded-md border border-[#c9ecd9] bg-[#effaf4] px-2.5 py-1.5">{s.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={tryReal} loading={real?.busy} disabled={dirty}>
              Generar una respuesta real con la IA
            </Button>
            <span className="text-[12px] text-fg-muted">{dirty ? "Guardá los cambios para probarlos con la IA." : "Usa la configuración guardada y consume una llamada de tu proveedor."}</span>
          </div>
          {real && !real.busy ? (
            <p className="mt-2 text-[13px]">
              <span className="text-[11.5px] text-fg-muted">Respuesta generada por el modelo</span>
              <span className="mt-0.5 block whitespace-pre-wrap rounded-md border border-[#b2ccff] bg-info-soft px-2.5 py-1.5">{real.text}</span>
            </p>
          ) : null}
        </section>

        {persona.notes.length ? (
          <Note tone="warning">
            <span className="font-medium">Cómo se resuelven las combinaciones elegidas:</span>
            {persona.notes.map((n, i) => (
              <span key={i} className="block">
                · {n.message}
              </span>
            ))}
          </Note>
        ) : null}
        <Note>
          <span className="font-medium">Así se le indica el estilo a la IA:</span> {persona.lines.join(" ")}
        </Note>

        <details className="rounded-md border border-border" open={Boolean(bot.instructions.trim())}>
          <summary className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold">Instrucciones particulares (avanzado)</summary>
          <div className="px-3 pb-3">
            <Field label="Instrucciones del bot" hint="Se respetan textualmente. Pueden precisar el estilo, pero nunca pasar por alto las reglas de la plataforma ni las obligatorias de la empresa. Los precios y el stock van en Productos.">
              {(f) => <Textarea {...f} rows={8} maxLength={8000} value={instructions} disabled={!canEdit} onChange={(e) => setInstructions(e.target.value)} />}
            </Field>
          </div>
        </details>
      </SectionCard>
    </form>
  );
}
