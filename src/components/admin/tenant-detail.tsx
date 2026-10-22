"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDateTime, formatNumber } from "@/lib/format";
import { LIMIT_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/plans";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

type D = {
  tenant: { id: string; name: string; slug: string; status: string };
  subscription: { status: string; notes: string | null; planId: string; trialEndsAt: string | null; updatedAt: string };
  usage: { period: string; plan: { planCode: string; planName: string; limits: Record<string, number | string | null> }; usage: Record<string, number> };
  chatwoot: { accountId: number; status: string; lastError: string | null; provisionedBy: string; webhookConfigured: boolean } | null;
  channels: { id: string; displayName: string; phoneNumber: string; status: string; lastError: string | null; lastVerifiedAt: string | null }[];
};

export function TenantDetailAdmin({ id }: { id: string }) {
  const d = useApi<D>(`/api/platform/tenants/${id}`);
  const plans = useApi<{ code: string; name: string }[]>("/api/platform/plans");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  if (d.loading) return <SkeletonRows />;
  if (!d.data) return <ErrorState description={d.error?.message} />;
  const t = d.data;

  async function call(key: string, path: string, body: unknown, ok: string, method = "POST") {
    setBusy(key);
    try {
      const r = await api<{ devUrl?: string }>(path, { method, body });
      toast.push("success", ok);
      if (r && "devUrl" in r && r.devUrl) setDevUrl(r.devUrl);
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Empresas
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-semibold">{t.tenant.name}</h1>
        <Badge tone={t.tenant.status === "active" ? "success" : "danger"}>{t.tenant.status === "active" ? "Activa" : "Suspendida"}</Badge>
        <span className="text-[12.5px] text-fg-muted">{t.tenant.slug}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Suscripción" description={`Última modificación ${formatDateTime(t.subscription.updatedAt)}. El cobro es manual (fuera de Loopchat).`}>
          <form
            className="flex flex-col gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const status = String(fd.get("status"));
              if ((status === "suspended" || status === "cancelled") && !window.confirm("La empresa quedará en solo lectura: sin bots ni envíos. ¿Continuar?")) return;
              void call("sub", `/api/platform/tenants/${id}`, { planCode: fd.get("plan"), status, notes: fd.get("notes") || undefined }, "Suscripción actualizada (auditado).", "PATCH");
            }}
          >
            <Field label="Plan">
              {(p) => (
                <Select {...p} name="plan" defaultValue={t.usage.plan.planCode}>
                  {plans.data?.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Estado">
              {(p) => (
                <Select {...p} name="status" defaultValue={t.subscription.status}>
                  {Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Notas internas (facturación manual)">{(p) => <Textarea {...p} name="notes" defaultValue={t.subscription.notes ?? ""} rows={2} />}</Field>
            <Button type="submit" variant="secondary" loading={busy === "sub"} className="self-end">
              Guardar
            </Button>
          </form>
        </Panel>
        <Panel title={`Consumo ${t.usage.period}`}>
          <table className="w-full text-[13px]">
            <tbody>
              {[
                ["whatsappNumbers", t.usage.usage.whatsappNumbers],
                ["agents", t.usage.usage.agents],
                ["pipelines", t.usage.usage.pipelines],
                ["activeBots", t.usage.usage.activeBots],
                ["aiCallsPerMonth", t.usage.usage.aiCalls],
              ].map(([k, v]) => (
                <tr key={String(k)} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{LIMIT_LABELS[k as keyof typeof LIMIT_LABELS]}</td>
                  <td className="px-4 py-2 text-right tabular">
                    {formatNumber(Number(v))} / {t.usage.plan.limits[String(k)] === null ? "uso justo" : formatNumber(Number(t.usage.plan.limits[String(k)]))}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2">Mensajes (entrantes / salientes)</td>
                <td className="px-4 py-2 text-right tabular">
                  {formatNumber(t.usage.usage.messagesIn)} / {formatNumber(t.usage.usage.messagesOut)}
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Motor de mensajería (Chatwoot CE)">
          <div className="flex flex-col gap-3 p-4 text-[13px]">
            {t.chatwoot ? (
              <p>
                Cuenta <strong className="tabular">#{t.chatwoot.accountId}</strong> · {t.chatwoot.provisionedBy === "platform_api" ? "aprovisionada por Platform API" : "vinculada manualmente"} · webhook {t.chatwoot.webhookConfigured ? "firmado activo" : "sin configurar"}
                {t.chatwoot.lastError ? <span className="block text-danger">{t.chatwoot.lastError}</span> : null}
              </p>
            ) : (
              <>
                <p className="text-fg-secondary">Sin cuenta. Aprovisionarla crea cuenta + usuario de servicio + webhook firmado con la Platform App configurada en el servidor.</p>
                <Button variant="primary" loading={busy === "cw"} onClick={() => call("cw", `/api/platform/tenants/${id}/chatwoot`, { mode: "provision" }, "Cuenta de Chatwoot aprovisionada.")} className="self-start">
                  Aprovisionar cuenta
                </Button>
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer text-fg-secondary">Vincular una cuenta existente (manual)</summary>
                  <form
                    className="mt-2 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      void call("cw", `/api/platform/tenants/${id}/chatwoot`, { mode: "link", link: { chatwootAccountId: Number(fd.get("acc")), apiAccessToken: String(fd.get("token")) } }, "Cuenta vinculada.");
                    }}
                  >
                    <Input name="acc" aria-label="ID de cuenta Chatwoot" inputMode="numeric" required placeholder="ID de cuenta" />
                    <Input name="token" aria-label="Token de acceso" type="password" required placeholder="Access token de un administrador de esa cuenta" />
                    <Button type="submit" size="sm" className="self-start">
                      Verificar y vincular
                    </Button>
                  </form>
                </details>
              </>
            )}
            {t.chatwoot ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === "rec"} onClick={() => call("rec", `/api/platform/tenants/${id}/ops`, { action: "reconcile" }, "Reconciliación encolada.")}>
                  Reconciliar conversaciones
                </Button>
                <Button size="sm" loading={busy === "rep"} onClick={() => call("rep", `/api/platform/tenants/${id}/ops`, { action: "reprocess_failed" }, "Eventos fallidos reencolados.")}>
                  Reprocesar eventos fallidos
                </Button>
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel title="Números de WhatsApp" description="Estado técnico (sin tokens).">
          <ul className="divide-y divide-border text-[13px]">
            {t.channels.length === 0 ? <li className="px-4 py-3 text-fg-muted">Sin números conectados.</li> : null}
            {t.channels.map((c) => (
              <li key={c.id} className="px-4 py-2.5">
                <span className="font-medium">{c.displayName}</span> <span className="tabular text-fg-muted">{c.phoneNumber}</span> <Badge tone={c.status === "connected" ? "success" : c.status === "error" ? "danger" : "neutral"}>{c.status}</Badge>
                {c.lastError ? <p className="text-[12.5px] text-danger">{c.lastError}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Invitar usuario a esta empresa" className="lg:col-span-2">
          <form
            className="flex flex-wrap gap-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void call("inv", `/api/platform/tenants/${id}/invite`, { email: fd.get("email"), role: fd.get("role") }, "Invitación enviada.");
            }}
          >
            <Input name="email" type="email" required aria-label="Email" placeholder="email@empresa.com" className="min-w-0 flex-1 basis-56" />
            <Select name="role" aria-label="Rol" defaultValue="tenant_admin" className="w-48">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={busy === "inv"}>
              Invitar
            </Button>
          </form>
          {devUrl ? (
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-2 text-[12px]">
              <span className="font-medium">Desarrollo (sin SMTP):</span>
              <code className="truncate">{devUrl}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(devUrl)} aria-label="Copiar enlace">
                <Copy className="size-3.5" />
              </button>
            </div>
          ) : null}
          <p className="px-4 pb-4 text-[12px] text-fg-muted">Loop Smiths no tiene acceso a las conversaciones de la empresa: la impersonación está deshabilitada en V1.</p>
        </Panel>
      </div>
    </div>
  );
}
