"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { Note, SaveBar, SectionCard, Toggle, useSaveBot, type SectionProps } from "./shared";

type LeadField = { id: string; key: string; label: string; type: "text" | "number" | "choice"; options: string[]; hint: string | null };
const TYPE_LABEL = { text: "Texto", number: "Número", choice: "Lista de opciones" } as const;
const SUGGESTIONS = ["Producto buscado", "Cantidad", "Presupuesto aproximado", "Urgencia", "Ubicación", "Necesita asesoramiento"];

export function ObjectivesSection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const toast = useToast();
  const fields = useApi<LeadField[]>("/api/v1/lead-fields");
  const [sel, setSel] = useState(bot.config.objectives.fields);
  const [collect, setCollect] = useState(bot.allowedTools.includes("collect_data"));
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<LeadField["type"]>("text");
  const has = (k: string) => sel.find((f) => f.key === k);
  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const tools = new Set(bot.allowedTools);
          if (collect) tools.add("collect_data");
          else tools.delete("collect_data");
          void save({ ...(bot.mode === "instructions" ? { allowedTools: [...tools] } : {}), config: { objectives: { fields: sel.filter((s) => (fields.data ?? []).some((f) => f.key === s.key)) } } });
        }}
      >
        <SectionCard
          title="Datos comerciales a recopilar"
          description="Qué información conviene que el bot obtenga durante la charla. La pide de forma natural (como mucho una pregunta por mensaje), respeta si el cliente no quiere responder y nunca completa datos inventados."
          footer={<SaveBar canEdit={canEdit} busy={busy} />}
        >
          {bot.mode === "instructions" ? <Toggle checked={collect} disabled={!canEdit} onChange={setCollect} label="Recopilar datos comerciales" description="Los datos quedan en la ficha del contacto (con origen “bot”) y se ven en la conversación." /> : <Note>En los bots de flujo visual, habilitá “Recopilar datos comerciales” en el paso de IA.</Note>}
          {fields.loading ? <SkeletonRows rows={2} /> : null}
          {fields.data?.length === 0 ? <EmptyState title="Tu empresa todavía no definió datos comerciales" description="Creá los campos abajo (por ejemplo: producto buscado, cantidad, presupuesto)." /> : null}
          <ul className="flex flex-col gap-1.5">
            {fields.data?.map((f) => {
              const s = has(f.key);
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" checked={Boolean(s)} disabled={!canEdit} onChange={(e) => setSel((x) => (e.target.checked ? [...x, { key: f.key, required: false }] : x.filter((y) => y.key !== f.key)))} />
                    <span className="font-medium">{f.label}</span>
                    <Badge>{TYPE_LABEL[f.type]}</Badge>
                    {f.type === "choice" ? <span className="text-[12px] text-fg-muted">{f.options.join(" / ")}</span> : null}
                  </label>
                  {s ? (
                    <label className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" checked={s.required} disabled={!canEdit} onChange={(e) => setSel((x) => x.map((y) => (y.key === f.key ? { ...y, required: e.target.checked } : y)))} />
                      Prioritario
                    </label>
                  ) : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Quitar campo ${f.label}`}
                      onClick={async () => {
                        if (!window.confirm(`¿Quitar el campo "${f.label}" de la empresa? Los datos ya guardados en los contactos se conservan.`)) return;
                        try {
                          await api(`/api/v1/lead-fields/${f.id}`, { method: "DELETE" });
                          setSel((x) => x.filter((y) => y.key !== f.key));
                          void fields.reload();
                        } catch (err) {
                          toast.push("error", (err as ApiError).message);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Note>“Prioritario” = el bot intenta obtenerlo antes que los demás, sin forzar. Los campos son de la empresa y se comparten entre bots.</Note>
        </SectionCard>
      </form>
      {canEdit ? (
        <SectionCard title="Nuevo dato comercial" description="Se agrega para toda la empresa.">
          {!adding ? (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.filter((sug) => !(fields.data ?? []).some((f) => f.label.toLowerCase() === sug.toLowerCase())).map((sug) => (
                <Button
                  key={sug}
                  size="sm"
                  onClick={async () => {
                    try {
                      await api("/api/v1/lead-fields", { body: sug === "Cantidad" || sug === "Presupuesto aproximado" ? { label: sug, type: "number" } : sug === "Urgencia" ? { label: sug, type: "choice", options: ["Hoy", "Esta semana", "Sin apuro"] } : sug === "Necesita asesoramiento" ? { label: sug, type: "choice", options: ["Sí", "No"] } : { label: sug } });
                      void fields.reload();
                    } catch (err) {
                      toast.push("error", (err as ApiError).message);
                    }
                  }}
                >
                  <Plus className="size-3.5" aria-hidden /> {sug}
                </Button>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                Campo personalizado
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-3 md:grid-cols-[1fr_200px_1fr_auto] md:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                try {
                  await api("/api/v1/lead-fields", { body: { label: fd.get("label"), type, options: type === "choice" ? String(fd.get("options") ?? "").split(",").map((o) => o.trim()).filter(Boolean) : [] } });
                  setAdding(false);
                  void fields.reload();
                } catch (err) {
                  toast.push("error", (err as ApiError).message);
                }
              }}
            >
              <Field label="Nombre">{(f) => <Input {...f} name="label" required minLength={2} maxLength={60} placeholder="Medio de pago preferido" />}</Field>
              <Field label="Tipo">
                {(f) => (
                  <Select {...f} value={type} onChange={(e) => setType(e.target.value as LeadField["type"])}>
                    <option value="text">Texto</option>
                    <option value="number">Número</option>
                    <option value="choice">Lista de opciones</option>
                  </Select>
                )}
              </Field>
              {type === "choice" ? <Field label="Opciones (separadas por coma)">{(f) => <Input {...f} name="options" required placeholder="Efectivo, Tarjeta, Transferencia" />}</Field> : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="secondary">
                  Agregar
                </Button>
              </div>
            </form>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}
