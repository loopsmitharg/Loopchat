"use client";
import { useState } from "react";
import { AI_TOOLS, TOOL_LABELS, type AiTool } from "@/lib/flow/types";
import { Field, Input, Select } from "@/components/ui/field";
import { Note, SaveBar, SectionCard, useSaveBot, type Member, type SectionProps, type StageOpt } from "./shared";

const TOOL_HELP: Record<AiTool, string> = {
  classify: "Etiqueta la intención: consulta, precio, compra, reclamo, turno.",
  use_knowledge: "Busca en preguntas frecuentes y documentos (sección Conocimiento).",
  use_catalog: "Busca productos, precios y stock cargados (sección Productos).",
  create_opportunity: "Crea o actualiza UNA oportunidad abierta por contacto (sin duplicados).",
  update_stage: "Mueve la oportunidad solo a las etapas autorizadas abajo. Nunca a ganada ni perdida.",
  create_task: "Crea un seguimiento para el equipo con el responsable y vencimiento de abajo.",
  handoff: "La IA puede pedir una persona (cliente molesto o consulta fuera de alcance).",
  collect_data: "Guarda en el contacto los datos comerciales que el cliente dice (sección Objetivos).",
};

export function ToolsSection({ bot, canEdit, onSaved, stages, members }: SectionProps & { stages: StageOpt[]; members: Member[] }) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const [tools, setTools] = useState<Set<string>>(new Set(bot.allowedTools));
  const [t, setT] = useState(bot.config.tools);
  const openStages = stages.filter((s) => (s.kind ?? "open") === "open");
  const assignable = members.filter((m) => m.status === "active" && m.role !== "viewer");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ ...(bot.mode === "instructions" ? { allowedTools: [...tools] } : {}), config: { tools: t } });
      }}
    >
      <SectionCard title="Herramientas y acciones" description="Qué puede hacer el bot en el CRM. Los permisos se validan en el servidor: aunque el modelo lo intente, una acción no autorizada no se ejecuta y queda registrada." footer={<SaveBar canEdit={canEdit} busy={busy} />}>
        {bot.mode === "instructions" ? (
          <fieldset className="grid gap-2 md:grid-cols-2">
            <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Acciones permitidas</legend>
            {AI_TOOLS.map((tool) => (
              <label key={tool} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={tools.has(tool)}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const n = new Set(tools);
                    if (e.target.checked) n.add(tool);
                    else n.delete(tool);
                    setTools(n);
                  }}
                />
                <span>
                  <span className="font-medium">{TOOL_LABELS[tool]}</span>
                  <span className="block text-[12px] text-fg-muted">{TOOL_HELP[tool]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <Note>En los bots de flujo visual, las acciones se eligen en cada paso de IA. Las reglas de abajo se aplican igual.</Note>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Etapas a las que puede mover oportunidades</legend>
          <p className="text-[12.5px] text-fg-muted">Sin marcar ninguna = todas las etapas abiertas. Las etapas de cierre (ganada/perdida) nunca están disponibles para el bot: cerrar una venta requiere una persona.</p>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {openStages.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={t.allowedStageIds.includes(s.id)}
                  disabled={!canEdit}
                  onChange={(e) => setT((x) => ({ ...x, allowedStageIds: e.target.checked ? [...x.allowedStageIds, s.id] : x.allowedStageIds.filter((id) => id !== s.id) }))}
                />
                {s.name}
                {s.pipelineName ? <span className="text-[11.5px] text-fg-muted">· {s.pipelineName}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Responsable de las tareas">
            {(f) => (
              <Select {...f} value={t.taskAssignee} disabled={!canEdit} onChange={(e) => setT((x) => ({ ...x, taskAssignee: e.target.value as typeof x.taskAssignee }))}>
                <option value="conversation">El responsable de la conversación</option>
                <option value="user">Una persona fija</option>
                <option value="none">Sin asignar</option>
              </Select>
            )}
          </Field>
          {t.taskAssignee === "user" ? (
            <Field label="Persona">
              {(f) => (
                <Select {...f} value={t.taskAssigneeUserId ?? ""} disabled={!canEdit} required onChange={(e) => setT((x) => ({ ...x, taskAssigneeUserId: e.target.value || null }))}>
                  <option value="">Elegí…</option>
                  {assignable.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Vencimiento por defecto (horas)">
            {(f) => <Input {...f} type="number" min={1} max={720} value={t.taskDefaultDueHours} disabled={!canEdit} onChange={(e) => setT((x) => ({ ...x, taskDefaultDueHours: Number(e.target.value) || 1 }))} />}
          </Field>
          <Field label="Vencimiento máximo (horas)" hint="Límite aunque la IA proponga más.">
            {(f) => <Input {...f} type="number" min={1} max={2160} value={t.taskMaxDueHours} disabled={!canEdit} onChange={(e) => setT((x) => ({ ...x, taskMaxDueHours: Number(e.target.value) || 1 }))} />}
          </Field>
        </div>
      </SectionCard>
    </form>
  );
}
