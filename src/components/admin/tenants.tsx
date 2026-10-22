"use client";
import Link from "next/link";
import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/plans";

type Row = { id: string; name: string; slug: string; status: string; createdAt: string; planName: string; subscriptionStatus: string; members: number; numbers: number; chatwootAccountId: number | null };
type Health = { status: string; database: string; chatwoot?: string; queue?: { queued: number; failed: number; oldest_seconds: number | null; stuck: number } };

export function TenantsAdmin() {
  const list = useApi<Row[]>("/api/platform/tenants");
  const plans = useApi<{ code: string; name: string; isActive: boolean }[]>("/api/platform/plans");
  const health = useApi<Health>("/api/platform/health", { pollMs: 30000 });
  const overview = useApi<{ tenant_id: string; failed_events: number; failed_jobs: number; last_event_at: string | null; channels_error: number }[]>("/api/platform/overview", { pollMs: 60000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; devUrl?: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <div>
      <PageHeader
        title="Empresas"
        description="Altas, planes, suspensión y estado técnico. Sin acceso a conversaciones ni secretos."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nueva empresa
          </Button>
        }
      />
      {health.data ? (
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]">
          <span>
            Estado: <strong className={health.data.status === "ok" ? "text-success" : "text-danger"}>{health.data.status === "ok" ? "operativo" : "degradado"}</strong>
          </span>
          <span>Base de datos: {health.data.database}</span>
          <span>Chatwoot: {health.data.chatwoot ?? "—"}</span>
          {health.data.queue ? (
            <span>
              Cola: {health.data.queue.queued} pendientes · {health.data.queue.failed} fallidos (24 h){health.data.queue.oldest_seconds ? ` · más antiguo ${health.data.queue.oldest_seconds}s` : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      <Panel title={`${list.data?.length ?? 0} empresas`}>
        {list.loading ? <SkeletonRows /> : null}
        {list.data?.length === 0 ? <EmptyState title="Sin empresas" description="Creá la primera empresa e invitá a su administrador." /> : null}
        {list.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-fg-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Empresa</th>
                  <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                  <th scope="col" className="px-4 py-2 font-medium">Suscripción</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Usuarios</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Números</th>
                  <th scope="col" className="px-4 py-2 font-medium">Chatwoot</th>
                  <th scope="col" className="px-4 py-2 font-medium">Alertas</th>
                  <th scope="col" className="px-4 py-2 font-medium">Alta</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/empresas/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      <span className="block text-[12px] text-fg-muted">{t.slug}</span>
                    </td>
                    <td className="px-4 py-2.5">{t.planName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={["active", "trial"].includes(t.subscriptionStatus) ? "success" : t.subscriptionStatus === "past_due" ? "warning" : "danger"}>{SUBSCRIPTION_STATUS_LABELS[t.subscriptionStatus]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{t.members}</td>
                    <td className="px-4 py-2.5 text-right tabular">{t.numbers}</td>
                    <td className="px-4 py-2.5">{t.chatwootAccountId ? <span className="tabular">#{t.chatwootAccountId}</span> : <span className="text-fg-muted">Sin aprovisionar</span>}</td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const o = overview.data?.find((x) => x.tenant_id === t.id);
                        if (!o) return <span className="text-fg-muted">—</span>;
                        const alerts = [o.failed_events ? `${o.failed_events} eventos fallidos` : null, o.failed_jobs ? `${o.failed_jobs} trabajos fallidos (7 d)` : null, o.channels_error ? `${o.channels_error} números con error` : null].filter(Boolean);
                        return alerts.length ? <span className="text-[12.5px] text-danger">{alerts.join(" · ")}</span> : <span className="text-[12.5px] text-success">Sin alertas</span>;
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      <Modal open={open} onClose={() => { setOpen(false); setCreated(null); }} title="Nueva empresa" description="Se crea con el pipeline inicial editable y se invita a su administrador.">
        {created ? (
          <div className="flex flex-col gap-3 text-[13px]">
            <p>Empresa creada. Invitación enviada a <strong>{created.email}</strong>.</p>
            {created.devUrl ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-2 text-[12px]">
                <span className="font-medium">Desarrollo (sin SMTP):</span>
                <code className="truncate">{created.devUrl}</code>
                <button type="button" onClick={() => navigator.clipboard.writeText(created.devUrl!)} aria-label="Copiar enlace">
                  <Copy className="size-3.5" />
                </button>
              </div>
            ) : null}
            <Button onClick={() => { setOpen(false); setCreated(null); }} className="self-end">
              Cerrar
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setBusy(true);
              setFormError(null);
              try {
                const r = await api<{ invitation: { email: string; devUrl?: string } }>("/api/platform/tenants", {
                  body: { name: fd.get("name"), slug: fd.get("slug"), planCode: fd.get("plan"), adminEmail: fd.get("email"), subscriptionStatus: fd.get("status") },
                });
                setCreated(r.invitation);
                void list.reload();
              } catch (err) {
                setFormError((err as ApiError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Nombre">{(p) => <Input {...p} name="name" required minLength={2} />}</Field>
            <Field label="Identificador" hint="Minúsculas, números y guiones.">{(p) => <Input {...p} name="slug" required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" />}</Field>
            <Field label="Plan">
              {(p) => (
                <Select {...p} name="plan" defaultValue="starter">
                  {plans.data?.filter((x) => x.isActive).map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Estado inicial">
              {(p) => (
                <Select {...p} name="status" defaultValue="trial">
                  <option value="trial">Prueba (30 días)</option>
                  <option value="active">Activa (cobro manual)</option>
                </Select>
              )}
            </Field>
            <Field label="Email del administrador de la empresa">{(p) => <Input {...p} name="email" type="email" required />}</Field>
            {formError ? (
              <p role="alert" className="text-[13px] text-danger">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!plans.data}>
                Crear e invitar
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
