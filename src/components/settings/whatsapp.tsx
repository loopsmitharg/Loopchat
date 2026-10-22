"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type Channel = { id: string; displayName: string; phoneNumber: string; wabaId: string; phoneNumberId: string; tokenHint: string; status: string; lastVerifiedAt: string | null; lastError: string | null; tokenRotatedAt: string | null };
const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  connected: { label: "Conectado", tone: "success" },
  pending_verification: { label: "Verificando", tone: "warning" },
  error: { label: "Con error", tone: "danger" },
  disconnected: { label: "Desconectado", tone: "neutral" },
};

export function WhatsappSettings({ chatwootReady }: { chatwootReady: boolean }) {
  const list = useApi<Channel[]>("/api/v1/channels");
  const canManage = useCan("credentials:manage");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [rotate, setRotate] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, path: string, body: unknown, ok: string) {
    setBusy(id);
    try {
      const r = await api<Channel>(path, { body });
      toast.push(r.status === "connected" || r.status === "disconnected" ? "success" : "error", r.status === "error" ? `No se pudo verificar: ${r.lastError}` : ok);
      void list.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!chatwootReady ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> Loop Smiths todavía no habilitó el motor de mensajería para tu empresa. Podés preparar los datos; la conexión se completa cuando esté habilitado.
        </p>
      ) : null}
      <Panel title="Números conectados" description="Cada número usa tu propia cuenta de WhatsApp Cloud API (Meta). Los cargos de Meta se facturan a tu empresa.">
        {list.loading ? <SkeletonRows rows={2} /> : null}
        {list.data?.length === 0 ? <EmptyState title="Sin números conectados" description="Completá el formulario de abajo con los datos de tu cuenta de Meta." /> : null}
        <ul className="divide-y divide-border">
          {list.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.displayName} · <span className="tabular">{c.phoneNumber}</span>
                </p>
                <p className="text-[12px] text-fg-muted">
                  WABA {c.wabaId} · Phone Number ID {c.phoneNumberId} · Token {c.tokenHint}
                </p>
                <p className="text-[12px] text-fg-muted">Última verificación: {formatDateTime(c.lastVerifiedAt)}</p>
                {c.lastError ? <p className="mt-1 text-[12.5px] text-danger">{c.lastError}</p> : null}
              </div>
              <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label ?? c.status}</Badge>
              {canManage && c.status !== "disconnected" ? (
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => run(c.id, `/api/v1/channels/${c.id}/verify`, {}, "Conexión verificada.")} loading={busy === c.id}>
                    <RefreshCw className="size-3.5" aria-hidden /> Verificar
                  </Button>
                  <Button size="sm" onClick={() => setRotate(c)}>
                    Rotar token
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`¿Desconectar ${c.phoneNumber}? Loopchat dejará de enviar y de ejecutar bots en este número. El historial se conserva.`)) void run(c.id, `/api/v1/channels/${c.id}/disconnect`, {}, "Número desconectado.");
                    }}
                  >
                    Desconectar
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
      {canManage ? (
        <Panel title="Conectar un número de WhatsApp (configuración guiada)">
          <ol className="mx-4 mt-4 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-fg-secondary">
            <li>En Meta Business, creá o elegí tu cuenta de WhatsApp Business (WABA) con un método de pago a nombre de tu empresa.</li>
            <li>Agregá y verificá el número en WhatsApp Manager. Copiá el <strong>WABA ID</strong> y el <strong>Phone Number ID</strong>.</li>
            <li>Creá un usuario del sistema con permisos <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code> y generá un token permanente.</li>
            <li>Completá el formulario. Loopchat verifica el número en Meta (solo lectura) y lo vincula al motor de mensajería.</li>
          </ol>
          <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="mx-4 mt-2 inline-flex items-center gap-1 text-[12.5px] underline">
            Guía oficial de Meta <ExternalLink className="size-3" aria-hidden />
          </a>
          <form
            className="grid gap-3 p-4 md:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              setBusy("new");
              setError(null);
              try {
                const r = await api<Channel>("/api/v1/channels", {
                  body: { displayName: fd.get("displayName"), phoneNumber: fd.get("phone"), wabaId: fd.get("waba"), phoneNumberId: fd.get("pnid"), accessToken: fd.get("token"), billingOwnerConfirmed: fd.get("billing") === "on" },
                });
                if (r.status === "connected") {
                  toast.push("success", "Número conectado.");
                  form.reset();
                } else setError(r.lastError ?? "No se pudo verificar la conexión.");
                void list.reload();
              } catch (err) {
                setError((err as ApiError).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            <Field label="Nombre interno">{(p) => <Input {...p} name="displayName" required placeholder="Ventas" />}</Field>
            <Field label="Número (formato internacional)">{(p) => <Input {...p} name="phone" required inputMode="tel" placeholder="+54 9 11 1234-5678" />}</Field>
            <Field label="WABA ID">{(p) => <Input {...p} name="waba" required inputMode="numeric" pattern="\d{5,30}" />}</Field>
            <Field label="Phone Number ID">{(p) => <Input {...p} name="pnid" required inputMode="numeric" pattern="\d{5,30}" />}</Field>
            <Field label="Token de acceso permanente" className="md:col-span-2" hint="Se guarda cifrado y nunca se vuelve a mostrar completo.">
              {(p) => <Input {...p} name="token" type="password" required minLength={20} autoComplete="off" />}
            </Field>
            <label className="flex items-start gap-2 text-[13px] md:col-span-2">
              <input type="checkbox" name="billing" required className="mt-0.5" />
              <span>
                Confirmo que el método de pago de Meta para este número está a nombre de mi empresa (no se usa una línea de crédito de Loop Smiths).
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-[13px] text-danger md:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" variant="primary" loading={busy === "new"} disabled={!chatwootReady}>
                <CheckCircle2 className="size-4" aria-hidden /> Verificar y conectar
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
      <Modal open={Boolean(rotate)} onClose={() => setRotate(null)} title="Rotar token de Meta" description={rotate ? `${rotate.displayName} · ${rotate.phoneNumber}` : undefined}>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (rotate) await run(rotate.id, `/api/v1/channels/${rotate.id}/rotate`, { accessToken: fd.get("token") }, "Token rotado y verificado.");
            setRotate(null);
          }}
        >
          <Field label="Nuevo token">{(p) => <Input {...p} name="token" type="password" required minLength={20} autoComplete="off" />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRotate(null)}>Cancelar</Button>
            <Button type="submit" variant="primary">
              Rotar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
