"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatMoney, formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { MODE_LABEL, STATUS_LABEL } from "@/components/inbox/labels";
import { LeadDataList, type LeadValue } from "./lead-data";

type Detail = {
  contact: { id: string; name: string; phoneE164: string | null; email: string | null; tags: string[]; notes: string | null; chatwootContactId: number | null };
  conversations: { id: string; status: string; attentionMode: string; lastMessageAt: string | null; lastMessagePreview: string | null }[];
  opportunities: { id: string; title: string; status: string; amount: string | null; currency: string; stageName: string }[];
};

export function ContactDetail({ id }: { id: string }) {
  const d = useApi<Detail>(`/api/v1/contacts/${id}`);
  const lead = useApi<LeadValue[]>(`/api/v1/contacts/${id}/lead-data`);
  const canWrite = useCan("contact:write");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (d.loading) return <SkeletonRows />;
  if (d.error || !d.data) return <ErrorState description={d.error?.message ?? "Contacto no encontrado."} />;
  const c = d.data.contact;
  return (
    <div className="p-4 sm:p-6">
      <Link href="/contactos" className="mb-3 inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Contactos
      </Link>
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={c.name} seed={c.id} size={44} />
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight">{c.name}</h1>
          <p className="text-[13px] text-fg-muted tabular">{formatPhone(c.phoneE164)}</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Datos">
          <form
            className="flex flex-col gap-3 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await api(`/api/v1/contacts/${id}`, {
                  method: "PATCH",
                  body: {
                    name: fd.get("name"),
                    email: fd.get("email") || null,
                    notes: fd.get("notes") || null,
                    tags: String(fd.get("tags") ?? "")
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                    ...(c.chatwootContactId ? {} : { phone: fd.get("phone") || null }),
                  },
                });
                toast.push("success", "Contacto actualizado.");
                void d.reload();
              } catch (err) {
                toast.push("error", (err as ApiError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Nombre">{(p) => <Input {...p} name="name" defaultValue={c.name} disabled={!canWrite} required />}</Field>
            <Field label="Teléfono" hint={c.chatwootContactId ? "Identidad de WhatsApp: no editable." : undefined}>
              {(p) => <Input {...p} name="phone" defaultValue={c.phoneE164 ?? ""} disabled={!canWrite || Boolean(c.chatwootContactId)} />}
            </Field>
            <Field label="Email">{(p) => <Input {...p} name="email" type="email" defaultValue={c.email ?? ""} disabled={!canWrite} />}</Field>
            <Field label="Etiquetas" hint="Separadas por coma.">{(p) => <Input {...p} name="tags" defaultValue={c.tags.join(", ")} disabled={!canWrite} />}</Field>
            <Field label="Notas">{(p) => <Textarea {...p} name="notes" defaultValue={c.notes ?? ""} disabled={!canWrite} />}</Field>
            {canWrite ? (
              <Button type="submit" variant="secondary" loading={busy} className="self-end">
                Guardar
              </Button>
            ) : null}
          </form>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Datos comerciales" description="Obtenidos por el bot o cargados por el equipo.">
            <div className="p-4">{lead.data ? <LeadDataList contactId={id} values={lead.data} canEdit={canWrite} onChanged={() => void lead.reload()} /> : <SkeletonRows rows={2} />}</div>
          </Panel>
          <Panel title="Oportunidades" description={`${d.data.opportunities.length} en total`}>
            <ul className="divide-y divide-border">
              {d.data.opportunities.length === 0 ? <li className="p-4 text-[13px] text-fg-muted">Sin oportunidades.</li> : null}
              {d.data.opportunities.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <Link href={`/pipeline?op=${o.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {o.title}
                  </Link>
                  <Badge tone={o.status === "won" ? "success" : o.status === "lost" ? "danger" : "neutral"}>{o.stageName}</Badge>
                  <span className="w-28 text-right tabular">{formatMoney(o.amount, o.currency)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Conversaciones">
            <ul className="divide-y divide-border">
              {d.data.conversations.length === 0 ? <li className="p-4 text-[13px] text-fg-muted">Sin conversaciones.</li> : null}
              {d.data.conversations.map((cv) => (
                <li key={cv.id} className="px-4 py-2.5 text-[13px]">
                  <Link href={`/conversaciones?c=${cv.id}`} className="block hover:underline">
                    <span className="font-medium">{STATUS_LABEL[cv.status]}</span>
                    <span className="text-fg-muted"> · {MODE_LABEL[cv.attentionMode]} · {formatRelative(cv.lastMessageAt)}</span>
                    <span className="block truncate text-fg-secondary">{cv.lastMessagePreview}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
