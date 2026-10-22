"use client";
import { useState } from "react";
import type { BotConfig } from "@/lib/bot-config";
import { Field, Select } from "@/components/ui/field";
import { useApi } from "@/lib/api-client";
import { SkeletonRows } from "@/components/ui/states";
import { Note, SaveBar, SectionCard, Toggle, useSaveBot, type Member, type SectionProps } from "./shared";

type Pipe = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; kind: string; position: number }[] };

/**
 * Pipeline asociado: dónde trabaja comercialmente el bot (principal + adicionales), en qué etapa
 * crea oportunidades, cuándo puede crearlas, cómo mueve etapas, etapa de cotización,
 * responsable por defecto y qué hace al recibir una conversación de otro bot.
 * El estado de la conversación (bot/humano) es distinto de la etapa comercial.
 */
export function PipelineSection({ bot, canEdit, onSaved, members }: SectionProps & { members: Member[] }) {
  const pipes = useApi<Pipe[]>("/api/v1/pipelines");
  const { save, busy } = useSaveBot(bot, onSaved);
  const [c, setC] = useState<BotConfig["pipeline"]>(bot.config.pipeline);
  const receptionist = bot.role === "receptionist";
  if (pipes.loading || !pipes.data) return <SkeletonRows rows={4} />;
  const all = pipes.data;
  const primary = all.find((p) => p.id === c.primaryPipelineId) ?? all.find((p) => p.isDefault) ?? all[0];
  const open = (p?: Pipe) => (p?.stages ?? []).filter((s) => s.kind === "open");
  const scope = [primary, ...all.filter((p) => c.extraPipelineIds.includes(p.id) && p.id !== primary?.id)].filter(Boolean) as Pipe[];
  const set = (patch: Partial<BotConfig["pipeline"]>) => setC((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(c) !== JSON.stringify(bot.config.pipeline);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ config: { pipeline: c } });
      }}
    >
      <SectionCard
        title="Pipeline asociado"
        description="En qué pipeline trabaja este bot y qué puede hacer con las oportunidades. El estado de la conversación (bot o persona) es independiente de la etapa comercial."
        footer={<SaveBar canEdit={canEdit} busy={busy} dirty={dirty} />}
      >
        {receptionist ? <Note tone="info">Este bot es <strong>recepcionista</strong>: deriva a otros bots y nunca crea ni mueve oportunidades. Igual podés elegir el pipeline para que vea el contexto del cliente.</Note> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Pipeline principal" hint="Ahí crea las oportunidades.">
            {(p) => (
              <Select {...p} value={c.primaryPipelineId ?? ""} disabled={!canEdit} onChange={(e) => set({ primaryPipelineId: e.target.value || null, initialStageId: null, quoteStageId: null })}>
                <option value="">Principal de la empresa{all.find((x) => x.isDefault) ? ` (${all.find((x) => x.isDefault)!.name})` : ""}</option>
                {all.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Etapa inicial" hint="Dónde nace una oportunidad nueva.">
            {(p) => (
              <Select {...p} value={c.initialStageId ?? ""} disabled={!canEdit || receptionist} onChange={(e) => set({ initialStageId: e.target.value || null })}>
                <option value="">Primera etapa del pipeline</option>
                {open(primary).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {all.length > 1 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Pipelines adicionales que puede consultar</legend>
            {all
              .filter((x) => x.id !== primary?.id)
              .map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                   
                    checked={c.extraPipelineIds.includes(x.id)}
                    disabled={!canEdit}
                    onChange={(e) => set({ extraPipelineIds: e.target.checked ? [...c.extraPipelineIds, x.id] : c.extraPipelineIds.filter((y) => y !== x.id) })}
                  />
                  {x.name}
                </label>
              ))}
            <p className="text-[12px] text-fg-muted">Sirve, por ejemplo, para un pipeline de soporte o de postventa (no hay módulo de tickets: los casos se manejan como oportunidades en ese pipeline).</p>
          </fieldset>
        ) : null}
        <fieldset className="flex flex-col gap-1.5" disabled={!canEdit || receptionist}>
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">¿Cuándo puede crear una oportunidad?</legend>
          {(
            [
              ["purchase_intent", "Solo con intención de compra concreta", "Un reclamo o una falla no es una venta, aunque mencione un precio."],
              ["any_inquiry", "Ante cualquier consulta por un producto o servicio", "Útil en pipelines de soporte o postventa para registrar cada caso."],
              ["never", "Nunca", "Solo consulta y, si tiene permiso, mueve oportunidades existentes."],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="createOpp" className="mt-0.5" checked={c.createOpportunity === v} onChange={() => set({ createOpportunity: v })} />
              <span>
                {label}
                <span className="block text-[12px] text-fg-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mover etapas" hint="Siempre dentro de las etapas permitidas (Herramientas y acciones). Nunca a ganada o perdida.">
            {(p) => (
              <Select {...p} value={c.stageMoves} disabled={!canEdit || receptionist} onChange={(e) => set({ stageMoves: e.target.value as BotConfig["pipeline"]["stageMoves"] })}>
                <option value="allowed_any">A cualquier etapa permitida</option>
                <option value="forward_only">Solo hacia adelante</option>
              </Select>
            )}
          </Field>
          <Field label="Etapa al pedir cotización" hint="Si el cliente pide un presupuesto, la oportunidad pasa a esta etapa.">
            {(p) => (
              <Select {...p} value={c.quoteStageId ?? ""} disabled={!canEdit || receptionist} onChange={(e) => set({ quoteStageId: e.target.value || null })}>
                <option value="">No mover</option>
                {scope.flatMap((x) =>
                  open(x).map((s) => (
                    <option key={s.id} value={s.id}>
                      {scope.length > 1 ? `${x.name} · ` : ""}
                      {s.name}
                    </option>
                  )),
                )}
              </Select>
            )}
          </Field>
          <Field label="Responsable por defecto" hint="Para las oportunidades que crea el bot.">
            {(p) => (
              <Select {...p} value={c.defaultOwnerUserId ?? ""} disabled={!canEdit} onChange={(e) => set({ defaultOwnerUserId: e.target.value || null })}>
                <option value="">Sin responsable</option>
                {members
                  .filter((m) => m.status === "active" && m.role !== "viewer")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-[13px] font-medium text-fg-secondary">Al recibir una conversación de otro bot del equipo</p>
          <Toggle checked={c.onTransferEnsureOpportunity} disabled={!canEdit || receptionist || c.createOpportunity === "never"} onChange={(v) => set({ onTransferEnsureOpportunity: v })} label="Asegurar una oportunidad en su pipeline" description="Si el cliente no tiene una abierta en este pipeline, se crea en la etapa inicial." />
          <Toggle checked={c.onTransferAssignOwner} disabled={!canEdit || !c.defaultOwnerUserId} onChange={(v) => set({ onTransferAssignOwner: v })} label="Asignar el responsable por defecto" description="Solo si la conversación o la oportunidad no tienen responsable. El responsable es la persona a cargo; el bot activo sigue respondiendo." />
        </div>
      </SectionCard>
    </form>
  );
}
