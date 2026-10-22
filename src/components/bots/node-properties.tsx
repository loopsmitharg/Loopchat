"use client";
import { AI_TOOLS, TOOL_LABELS, type AiTool, type FlowNode, type NodeData } from "@/lib/flow/types";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

type Stage = { id: string; name: string };

/** Formulario de propiedades por tipo de nodo (lo usan el lienzo y la vista lista). */
export function NodeProperties({ node, stages, disabled, onChange }: { node: FlowNode; stages: Stage[]; disabled: boolean; onChange: (data: unknown) => void }) {
  const d = node.data as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...d, ...patch });
  switch (node.type) {
    case "start":
      return <p className="text-[12.5px] text-fg-muted">Se ejecuta con cada mensaje entrante de una conversación atendida por el bot.</p>;
    case "end":
      return <p className="text-[12.5px] text-fg-muted">Termina la ejecución. El próximo mensaje del cliente vuelve a empezar desde Inicio.</p>;
    case "message": {
      const md = d as NodeData["message"];
      return (
        <Field label="Texto a enviar" hint="Variables: {{contact.name}}, {{intent}}, {{vars.nombre}}">
          {(p) => <Textarea {...p} value={md.text ?? ""} maxLength={4000} disabled={disabled} onChange={(e) => set({ text: e.target.value })} rows={5} />}
        </Field>
      );
    }
    case "ai": {
      const ad = d as NodeData["ai"];
      const tools = new Set(ad.tools ?? []);
      return (
        <div className="flex flex-col gap-3">
          <Field label="Instrucciones de este paso (opcional)" hint="Se suman a las instrucciones generales del bot.">
            {(p) => <Textarea {...p} value={ad.instructions ?? ""} disabled={disabled} onChange={(e) => set({ instructions: e.target.value })} rows={4} />}
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={ad.sendReply !== false} disabled={disabled} onChange={(e) => set({ sendReply: e.target.checked })} /> Enviar la respuesta de la IA al cliente
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Herramientas permitidas</legend>
            {AI_TOOLS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={tools.has(t)}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = new Set(tools);
                    if (e.target.checked) next.add(t);
                    else next.delete(t);
                    set({ tools: [...next] as AiTool[] });
                  }}
                />
                {TOOL_LABELS[t]}
              </label>
            ))}
          </fieldset>
        </div>
      );
    }
    case "condition": {
      const cd = d as NodeData["condition"];
      return (
        <div className="flex flex-col gap-3">
          <Field label="Evaluar">
            {(p) => (
              <Select {...p} value={cd.source} disabled={disabled} onChange={(e) => set({ source: e.target.value })}>
                <option value="message">Último mensaje del cliente</option>
                <option value="intent">Intención detectada por la IA</option>
                <option value="variable">Variable</option>
              </Select>
            )}
          </Field>
          {cd.source === "variable" ? (
            <Field label="Nombre de variable" hint='Variable de sistema: "horario" vale "abierto" o "cerrado" según el horario de atención.'>
              {(p) => <Input {...p} value={cd.variable ?? ""} disabled={disabled} onChange={(e) => set({ variable: e.target.value })} />}
            </Field>
          ) : null}
          <Field label="Condición">
            {(p) => (
              <Select {...p} value={cd.operator} disabled={disabled} onChange={(e) => set({ operator: e.target.value })}>
                <option value="contains_any">Contiene alguna de (separadas por coma)</option>
                <option value="equals">Es igual a</option>
                <option value="starts_with">Empieza con</option>
                <option value="not_empty">No está vacío</option>
                <option value="is_empty">Está vacío</option>
              </Select>
            )}
          </Field>
          {["contains_any", "equals", "starts_with"].includes(cd.operator) ? (
            <Field label="Valor" hint="Sin distinguir mayúsculas ni acentos.">
              {(p) => <Input {...p} value={cd.value ?? ""} disabled={disabled} onChange={(e) => set({ value: e.target.value })} />}
            </Field>
          ) : null}
        </div>
      );
    }
    case "opportunity": {
      const od = d as NodeData["opportunity"];
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-fg-muted">Crea la oportunidad del contacto si no tiene una abierta, o actualiza la existente.</p>
          <Field label="Mover a etapa">
            {(p) => (
              <Select {...p} value={od.stageId ?? ""} disabled={disabled} onChange={(e) => set({ stageId: e.target.value || null })}>
                <option value="">No cambiar / etapa inicial</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Título (si se crea)">{(p) => <Input {...p} value={od.title ?? ""} disabled={disabled} onChange={(e) => set({ title: e.target.value })} />}</Field>
          <Field label="Importe (opcional)">
            {(p) => <Input {...p} inputMode="decimal" value={od.amount ?? ""} disabled={disabled} onChange={(e) => set({ amount: e.target.value === "" ? null : Number(e.target.value.replace(/[^\d.]/g, "")) })} />}
          </Field>
        </div>
      );
    }
    case "handoff": {
      const hd = d as NodeData["handoff"];
      return (
        <Field label="Motivo de la transferencia" hint="Queda registrado en la conversación. El bot deja de responder.">
          {(p) => <Input {...p} value={hd.reason ?? ""} disabled={disabled} onChange={(e) => set({ reason: e.target.value })} />}
        </Field>
      );
    }
    case "wait": {
      const wd = d as NodeData["wait"];
      return (
        <Field label="Esperar respuesta del cliente (minutos)" hint='Si no responde a tiempo, sigue por "Sin respuesta" (si está conectada) o termina.'>
          {(p) => <Input {...p} type="number" min={1} max={10080} value={wd.timeoutMinutes ?? 60} disabled={disabled} onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })} />}
        </Field>
      );
    }
  }
}

export function nodeSummary(node: FlowNode): string {
  const d = node.data as Record<string, unknown>;
  switch (node.type) {
    case "message":
      return String(d.text ?? "").slice(0, 70) || "(sin texto)";
    case "ai":
      return `${d.sendReply === false ? "No responde" : "Responde"} · ${((d.tools as string[]) ?? []).length} herramientas`;
    case "condition":
      return `${d.source === "message" ? "Mensaje" : d.source === "intent" ? "Intención" : `Var ${d.variable ?? ""}`} ${d.operator === "contains_any" ? "contiene" : d.operator === "equals" ? "=" : d.operator === "starts_with" ? "empieza con" : d.operator === "is_empty" ? "vacío" : "no vacío"} ${d.value ?? ""}`.slice(0, 70);
    case "handoff":
      return String(d.reason ?? "") || "(sin motivo)";
    case "wait":
      return `Hasta ${d.timeoutMinutes ?? 60} min`;
    case "opportunity":
      return d.stageId ? "Mueve de etapa" : "Crea/actualiza";
    default:
      return "";
  }
}
