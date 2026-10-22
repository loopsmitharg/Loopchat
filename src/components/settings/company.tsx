"use client";
import { useState } from "react";
import { useCan } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { DAY_LABELS } from "@/lib/business-hours";

type T = { name: string; slug: string; timezone: string; defaultCurrency: string; settings: { autoCreateOpportunity?: boolean; businessHours?: { enabled: boolean; days: number[]; start: string; end: string } } };

export function CompanySettings() {
  const t = useApi<T>("/api/v1/tenant");
  const canWrite = useCan("settings:write");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (t.loading) return <SkeletonRows />;
  if (!t.data) return <ErrorState description={t.error?.message} />;
  return (
    <div className="flex flex-col gap-4">
    <Panel title="Datos de la empresa">
      <form
        className="grid gap-4 p-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api("/api/v1/tenant", {
              method: "PATCH",
              body: {
                name: fd.get("name"),
                timezone: fd.get("tz"),
                defaultCurrency: fd.get("currency"),
                autoCreateOpportunity: fd.get("auto") === "on",
                businessHours: { enabled: fd.get("bh") === "on", days: fd.getAll("day").map(Number), start: String(fd.get("start") || "09:00"), end: String(fd.get("end") || "18:00") },
              },
            });
            toast.push("success", "Guardado.");
            void t.reload();
          } catch (err) {
            toast.push("error", (err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nombre">{(p) => <Input {...p} name="name" defaultValue={t.data!.name} disabled={!canWrite} required />}</Field>
        <Field label="Identificador" hint="Lo define Loop Smiths.">{(p) => <Input {...p} defaultValue={t.data!.slug} disabled />}</Field>
        <Field label="Zona horaria">
          {(p) => (
            <Select {...p} name="tz" defaultValue={t.data!.timezone} disabled={!canWrite}>
              {["America/Argentina/Buenos_Aires", "America/Montevideo", "America/Santiago", "America/Asuncion", "America/Lima", "America/Bogota", "America/Mexico_City", "America/Sao_Paulo", "Europe/Madrid"].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Moneda por defecto">
          {(p) => (
            <Select {...p} name="currency" defaultValue={t.data!.defaultCurrency} disabled={!canWrite}>
              {["ARS", "USD", "UYU", "CLP", "PYG", "PEN", "COP", "MXN", "BRL", "EUR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-start gap-2 text-[13px] md:col-span-2">
          <input type="checkbox" name="auto" defaultChecked={t.data.settings.autoCreateOpportunity !== false} disabled={!canWrite} className="mt-0.5" />
          <span>
            Crear una oportunidad en la primera etapa cuando escribe un contacto nuevo
            <span className="block text-[12px] text-fg-muted">Si el contacto ya tiene una oportunidad abierta, se vincula a esa.</span>
          </span>
        </label>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3 md:col-span-2">
          <legend className="px-1 text-[13px] font-medium text-fg-secondary">Horario de atención</legend>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="bh" defaultChecked={t.data.settings.businessHours?.enabled ?? false} disabled={!canWrite} /> Usar horario de atención
          </label>
          <div className="flex flex-wrap gap-3 text-[13px]">
            {DAY_LABELS.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" name="day" value={i} defaultChecked={(t.data!.settings.businessHours?.days ?? [1, 2, 3, 4, 5]).includes(i)} disabled={!canWrite} /> {d}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5">
              Desde <Input type="time" name="start" defaultValue={t.data.settings.businessHours?.start ?? "09:00"} disabled={!canWrite} className="w-32" />
            </label>
            <label className="flex items-center gap-1.5">
              Hasta <Input type="time" name="end" defaultValue={t.data.settings.businessHours?.end ?? "18:00"} disabled={!canWrite} className="w-32" />
            </label>
          </div>
          <p className="text-[12px] text-fg-muted">
            Los flujos pueden usar la variable <code>horario</code> (valor <code>abierto</code> o <code>cerrado</code>) en un nodo Condición, por ejemplo para avisar fuera de horario o derivar solo en horario laboral.
          </p>
        </fieldset>
        {canWrite ? (
          <div className="flex justify-end md:col-span-2">
            <Button type="submit" variant="secondary" loading={busy}>
              Guardar
            </Button>
          </div>
        ) : null}
      </form>
    </Panel>
    {canWrite ? (
      <Panel title="Exportar datos" description="Descarga en CSV (compatible con Excel/Sheets). Queda registrado en auditoría.">
        <div className="flex flex-wrap gap-2 p-4">
          <a href="/api/v1/export?type=contacts" className="inline-flex h-9 items-center rounded-[var(--radius-ctl)] border border-border-strong px-3.5 text-sm font-medium hover:bg-surface-muted">
            Contactos (CSV)
          </a>
          <a href="/api/v1/export?type=opportunities" className="inline-flex h-9 items-center rounded-[var(--radius-ctl)] border border-border-strong px-3.5 text-sm font-medium hover:bg-surface-muted">
            Oportunidades (CSV)
          </a>
        </div>
      </Panel>
    ) : null}
    </div>
  );
}
