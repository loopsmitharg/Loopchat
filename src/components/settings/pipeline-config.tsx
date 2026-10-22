"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";

type Stage = { id?: string; name: string; kind: "open" | "won" | "lost" };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Required<Stage>[] };

function Editor({ p, canEdit, onSaved }: { p: Pipeline; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(p.name);
  const [stages, setStages] = useState<Stage[]>(p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })));
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: number) => {
    const n = [...stages];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    setStages(n);
  };
  return (
    <Panel title={p.isDefault ? `${p.name} (principal)` : p.name}>
      <div className="flex flex-col gap-2 p-4">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="w-20 text-fg-muted">Nombre</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="max-w-xs" />
        </label>
        <ol className="mt-2 flex flex-col gap-1.5">
          {stages.map((s, i) => (
            <li key={s.id ?? `n${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-right text-[12px] text-fg-muted tabular">{i + 1}.</span>
              <Input aria-label={`Nombre de la etapa ${i + 1}`} value={s.name} disabled={!canEdit} onChange={(e) => setStages(stages.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="min-w-0 max-w-xs flex-1" />
              <Select aria-label={`Tipo de la etapa ${i + 1}`} value={s.kind} disabled={!canEdit} onChange={(e) => setStages(stages.map((x, k) => (k === i ? { ...x, kind: e.target.value as Stage["kind"] } : x)))} className="w-36">
                <option value="open">Abierta</option>
                <option value="won">Cierre ganado</option>
                <option value="lost">Cierre perdido</option>
              </Select>
              {canEdit ? (
                <span className="flex">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStages(stages.filter((_, k) => k !== i))} aria-label="Eliminar etapa">
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {canEdit ? (
          <div className="mt-2 flex justify-between">
            <Button size="sm" onClick={() => setStages([...stages.slice(0, -2), { name: "Nueva etapa", kind: "open" }, ...stages.slice(-2)])}>
              <Plus className="size-3.5" aria-hidden /> Agregar etapa
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/v1/pipelines/${p.id}/stages`, { method: "PUT", body: { name, stages } });
                  toast.push("success", "Pipeline guardado.");
                  onSaved();
                } catch (e) {
                  toast.push("error", (e as ApiError).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Guardar etapas
            </Button>
          </div>
        ) : null}
        <p className="mt-1 text-[12px] text-fg-muted">Reglas: la primera etapa es la inicial (abierta); debe haber exactamente una de cierre ganado y una de cierre perdido. No se puede borrar una etapa con oportunidades.</p>
      </div>
    </Panel>
  );
}

export function PipelineSettings() {
  const list = useApi<Pipeline[]>("/api/v1/pipelines");
  const canEdit = useCan("pipeline:configure");
  const toast = useToast();
  if (list.loading) return <SkeletonRows />;
  return (
    <div className="flex flex-col gap-4">
      {list.data?.map((p) => (
        <Editor key={p.id + p.stages.map((s) => s.id).join()} p={p} canEdit={canEdit} onSaved={() => void list.reload()} />
      ))}
      {canEdit ? (
        <Button
          className="self-start"
          onClick={async () => {
            const name = window.prompt("Nombre del nuevo pipeline:");
            if (!name) return;
            try {
              await api("/api/v1/pipelines", { body: { name } });
              void list.reload();
            } catch (e) {
              toast.push("error", (e as ApiError).message);
            }
          }}
        >
          <Plus className="size-4" aria-hidden /> Nuevo pipeline
        </Button>
      ) : null}
    </div>
  );
}
