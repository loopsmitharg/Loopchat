"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { LIMIT_LABELS } from "@/lib/plans";

type Plan = { id: string; code: string; name: string; isActive: boolean; limits: { whatsappNumbers: number; agents: number; pipelines: number | null; activeBots: number; aiCallsPerMonth: number; editor: "basic" | "full" } };

function PlanForm({ p, onSaved }: { p: Plan; onSaved: () => void }) {
  const toast = useToast();
  const [l, setL] = useState(p.limits);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof Plan["limits"]) => (
    <label key={k} className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-fg-secondary">{LIMIT_LABELS[k]}</span>
      <Input
        type="number"
        min={0}
        className="w-32 text-right"
        value={l[k] === null ? "" : String(l[k])}
        placeholder={k === "pipelines" ? "uso justo" : undefined}
        onChange={(e) => setL({ ...l, [k]: e.target.value === "" && k === "pipelines" ? null : Number(e.target.value) })}
      />
    </label>
  );
  return (
    <Panel title={p.name} description={`Código: ${p.code}`}>
      <div className="flex flex-col gap-2 p-4">
        {num("whatsappNumbers")}
        {num("agents")}
        {num("pipelines")}
        {num("activeBots")}
        {num("aiCallsPerMonth")}
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-fg-secondary">{LIMIT_LABELS.editor}</span>
          <Select value={l.editor} onChange={(e) => setL({ ...l, editor: e.target.value as "basic" | "full" })} className="w-32">
            <option value="basic">Básico</option>
            <option value="full">Completo</option>
          </Select>
        </label>
        <Button
          variant="secondary"
          className="mt-2 self-end"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/platform/plans/${p.id}`, { method: "PATCH", body: { limits: l } });
              toast.push("success", "Plan actualizado: aplica inmediatamente a todas sus empresas.");
              onSaved();
            } catch (e) {
              toast.push("error", (e as ApiError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar límites
        </Button>
      </div>
    </Panel>
  );
}

export function PlansAdmin() {
  const plans = useApi<Plan[]>("/api/platform/plans");
  return (
    <div>
      <PageHeader title="Planes" description="Límites por defecto editables. No son precios comerciales; el cobro es manual en V1." />
      {plans.loading ? <SkeletonRows /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => (
          <PlanForm key={p.id} p={p} onSaved={() => void plans.reload()} />
        ))}
      </div>
    </div>
  );
}
