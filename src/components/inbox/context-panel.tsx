"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { ACTIVITY_LABEL } from "./labels";
import { LeadDataList } from "@/components/crm/lead-data";
import { useCan } from "@/components/shell/app-shell";
import type { ConvDetail } from "./types";

type Stage = { id: string; name: string; kind: string };

export function ContextPanel({ detail, stages, canWriteOpp, onChanged }: { detail: ConvDetail; stages: Stage[]; canWriteOpp: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const c = detail.contact;
  const canWriteContact = useCan("contact:write");

  async function move(oppId: string, version: number, stageId: string) {
    try {
      await api(`/api/v1/opportunities/${oppId}`, { method: "PATCH", body: { expectedVersion: version, stageId } });
      toast.push("success", "Etapa actualizada.");
      onChanged();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
      onChanged();
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 text-[13px]">
      <section aria-labelledby="ctx-contact">
        <h3 id="ctx-contact" className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-fg-muted">
          Contacto
        </h3>
        {c ? (
          <div className="flex flex-col gap-1">
            <Link href={`/contactos/${c.id}`} className="font-semibold text-fg hover:underline">
              {c.name}
            </Link>
            <span className="text-fg-secondary tabular">{formatPhone(c.phoneE164)}</span>
            {c.email ? <span className="text-fg-secondary">{c.email}</span> : null}
            {c.tags.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {c ? (
        <section aria-labelledby="ctx-lead">
          <h3 id="ctx-lead" className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-fg-muted">
            Datos comerciales
          </h3>
          <LeadDataList contactId={c.id} values={detail.leadData ?? []} canEdit={canWriteContact} onChanged={onChanged} />
        </section>
      ) : null}

      <section aria-labelledby="ctx-opps">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="ctx-opps" className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-muted">
            Oportunidades
          </h3>
          {canWriteOpp && !creating ? (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" aria-hidden /> Nueva
            </Button>
          ) : null}
        </div>
        {creating ? (
          <form
            className="mb-3 flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-2.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!c) return;
              setBusy(true);
              try {
                await api("/api/v1/opportunities", { body: { contactId: c.id, conversationId: detail.conversation.id, title, amount: amount ? Number(amount) : undefined, source: "whatsapp" } });
                setCreating(false);
                setTitle("");
                setAmount("");
                toast.push("success", "Oportunidad creada.");
                onChanged();
              } catch (err) {
                toast.push("error", (err as ApiError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="text-[12px] font-medium text-fg-secondary" htmlFor="opp-title">
              Título
            </label>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} placeholder="Ej.: Presupuesto amoladora" />
            <label className="text-[12px] font-medium text-fg-secondary" htmlFor="opp-amount">
              Importe estimado (opcional)
            </label>
            <Input id="opp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button size="sm" variant="primary" type="submit" loading={busy}>
                Crear
              </Button>
            </div>
          </form>
        ) : null}
        {detail.opportunities.length === 0 && !creating ? <p className="text-fg-muted">Sin oportunidades.</p> : null}
        <ul className="flex flex-col gap-2">
          {detail.opportunities.map((o) => (
            <li key={o.id} className="rounded-md border border-border bg-surface p-2.5">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/pipeline?op=${o.id}`} className="font-medium hover:underline">
                  {o.title}
                </Link>
                <span className="shrink-0 tabular text-fg-secondary">{formatMoney(o.amount, o.currency)}</span>
              </div>
              {canWriteOpp && o.status === "open" ? (
                <label className="mt-1.5 flex items-center gap-2 text-[12px] text-fg-muted">
                  Etapa
                  <select value={o.stageId} onChange={(e) => move(o.id, o.version, e.target.value)} className="h-7 flex-1 rounded border border-border-strong bg-surface px-1 text-[12.5px] text-fg">
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="mt-1">
                  <Badge tone={o.status === "won" ? "success" : o.status === "lost" ? "danger" : "neutral"}>{o.stageName}</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ctx-notes">
        <h3 id="ctx-notes" className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-fg-muted">
          Notas internas
        </h3>
        {detail.notes.length === 0 ? <p className="text-fg-muted">Sin notas.</p> : null}
        <ul className="flex flex-col gap-2">
          {detail.notes.map((n) => (
            <li key={n.id} className="rounded-md border border-[#fde3a7] bg-warning-soft px-2.5 py-2">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              <p className="mt-1 text-[11.5px] text-fg-muted">
                {n.authorName ?? "—"} · {formatDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ctx-activity">
        <h3 id="ctx-activity" className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-fg-muted">
          Actividad
        </h3>
        {detail.activity.length === 0 ? <p className="text-fg-muted">Sin actividad registrada.</p> : null}
        <ul className="flex flex-col gap-1.5">
          {detail.activity.map((a) => (
            <li key={a.id} className="text-[12.5px]">
              <span className="font-medium">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>
              <span className="text-fg-muted">
                {" "}
                · {a.actorKind === "bot" ? "Bot" : a.actorKind === "system" ? "Sistema" : (a.actorName ?? "—")} · {formatDateTime(a.createdAt)}
              </span>
              {a.reason ? <p className="text-fg-secondary">{a.reason}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
