"use client";
import Link from "next/link";
import { useState } from "react";
import { Lock } from "lucide-react";
import { RULE_CATEGORY_LABELS, type RuleCategory } from "@/lib/ai-profile";
import { AI_HANDOFF_CONDITIONS, type BotConfig } from "@/lib/bot-config";
import { AI_HANDOFF_TEXT } from "@/lib/instructions/catalog";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { MultiChoice, PhraseList } from "./persona-controls";
import { Note, SaveBar, SectionCard, Toggle, useSaveBot, type SectionProps } from "./shared";

type Rule = { id: string; text: string; category: RuleCategory; enabled: boolean; mandatory: boolean };

/**
 * Reglas de comportamiento: qué debe hacer, qué no, y cuándo derivar. Muestra las reglas
 * heredadas de la empresa: las obligatorias están bloqueadas; las demás se pueden desactivar.
 */
export function RulesSection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const profile = useApi<{ rules: Rule[] }>("/api/v1/ai-profile");
  const [b, setB] = useState<BotConfig["behavior"]>(bot.config.behavior);
  const [amount, setAmount] = useState(b.highValueAmount === null ? "" : String(b.highValueAmount));
  const rules = (profile.data?.rules ?? []).filter((r) => r.enabled);
  const dirty = JSON.stringify(b) !== JSON.stringify(bot.config.behavior) || amount !== (bot.config.behavior.highValueAmount === null ? "" : String(bot.config.behavior.highValueAmount));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = amount.trim() === "" ? null : Number(amount.replace(/\./g, "").replace(",", "."));
        void save({ config: { behavior: { ...b, highValueAmount: n !== null && Number.isFinite(n) ? n : null, disabledCompanyRules: b.disabledCompanyRules.filter((id) => rules.some((r) => r.id === id && !r.mandatory)) } } });
      }}
    >
      <SectionCard title="Reglas de comportamiento" description="Reglas propias de este bot. Las reglas de la empresa se heredan; las obligatorias no se pueden quitar." footer={<SaveBar canEdit={canEdit} busy={busy} dirty={dirty} />}>
        <section aria-labelledby="inherited" className="flex flex-col gap-2">
          <h3 id="inherited" className="text-[13.5px] font-semibold">
            Reglas heredadas de la empresa{" "}
            <Link href="/configuracion/identidad-ia" className="text-[12px] font-normal underline">
              (editarlas)
            </Link>
          </h3>
          {profile.loading ? <SkeletonRows rows={2} /> : null}
          {profile.data && !rules.length ? <p className="text-[13px] text-fg-muted">La empresa todavía no definió reglas generales.</p> : null}
          <ul className="flex flex-col gap-1.5">
            {rules.map((r) => {
              const off = b.disabledCompanyRules.includes(r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  {r.mandatory ? <Lock className="size-3.5 shrink-0 text-fg-muted" aria-label="Obligatoria" /> : null}
                  <span className={off ? "min-w-0 flex-1 text-fg-muted line-through" : "min-w-0 flex-1"}>{r.text}</span>
                  <Badge>{RULE_CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                  {r.mandatory ? (
                    <Badge tone="warning">Obligatoria · bloqueada</Badge>
                  ) : (
                    <label className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" checked={!off} disabled={!canEdit} onChange={(e) => setB((x) => ({ ...x, disabledCompanyRules: e.target.checked ? x.disabledCompanyRules.filter((y) => y !== r.id) : [...x.disabledCompanyRules, r.id] }))} />
                      Aplica a este bot
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-fg-muted">Las reglas obligatorias rigen al instante en todos los bots. Las demás se aplican al publicar una versión.</p>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <PhraseList label="Qué debe hacer" value={b.do} onChange={(v) => setB((x) => ({ ...x, do: v }))} disabled={!canEdit} placeholder="Ej.: Consultar el catálogo antes de informar precios" />
          <PhraseList label="Qué no debe hacer" value={b.dont} onChange={(v) => setB((x) => ({ ...x, dont: v }))} disabled={!canEdit} placeholder="Ej.: No aplicar descuentos sin autorización" />
        </div>

        <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
          <legend className="text-[13.5px] font-semibold">Cuándo debe derivar</legend>
          <Note>
            Sin IA (siempre activos según su configuración): el cliente pide una persona (palabras clave en <em>Derivación humana</em>), insultos, consultas seguidas sin resolver (<em>Horarios y reglas</em>), límite de uso (<em>Operación</em>) y las reglas de abajo.
          </Note>
          <Field label="Oportunidad de alto valor: derivar desde este importe" hint="Sin IA: si la oportunidad registrada supera el importe, pasa a un vendedor. Vacío = no aplica.">
            {(f) => <Input {...f} inputMode="decimal" value={amount} disabled={!canEdit} onChange={(e) => setAmount(e.target.value)} placeholder="Ej.: 500000" className="max-w-[220px]" />}
          </Field>
          <Toggle checked={b.handoffOnToolError} disabled={!canEdit} onChange={(v) => setB((x) => ({ ...x, handoffOnToolError: v }))} label="Error al ejecutar una acción" description="Si no se puede crear la oportunidad o la tarea, deriva a una persona en lugar de reintentar." />
          <MultiChoice legend="Evaluadas por la IA" value={b.handoffWhen} options={AI_HANDOFF_CONDITIONS.map((k) => ({ value: k, label: AI_HANDOFF_TEXT[k].label }))} onChange={(v) => setB((x) => ({ ...x, handoffWhen: v }))} disabled={!canEdit} hint="Requieren que el bot tenga la herramienta “pedir humano”." />
          <PhraseList label="Otras condiciones (las evalúa la IA)" value={b.customHandoff} onChange={(v) => setB((x) => ({ ...x, customHandoff: v }))} disabled={!canEdit} placeholder="Ej.: el cliente pide una factura A" max={10} />
        </fieldset>
      </SectionCard>
    </form>
  );
}
