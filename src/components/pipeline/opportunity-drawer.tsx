"use client";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, MessagesSquare, X } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

type Detail = {
  opportunity: { id: string; title: string; status: string; amount: string | null; currency: string; ownerUserId: string | null; followUpAt: string | null; stageId: string; version: number; conversationId: string | null; source: string; lostReason: string | null; createdAt: string };
  contact: { id: string; name: string; phoneE164: string | null } | null;
  stages: { id: string; name: string; kind: string }[];
  history: { id: string; field: string; fromValue: string | null; toValue: string | null; actorKind: string; actorName: string | null; createdAt: string }[];
  notes: { id: string; body: string; authorName: string | null; createdAt: string }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null }[];
};

const FIELD_LABEL: Record<string, string> = { created: "Creada", stage: "Etapa", status: "Estado", amount: "Importe", title: "Título", owner: "Responsable", follow_up: "Seguimiento", currency: "Moneda" };

export function OpportunityDrawer({ id, members, onClose, onChanged }: { id: string; members: { userId: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const canWrite = useCan("opportunity:write");
  const canTask = useCan("task:write");
  const canNote = useCan("conversation:note");
  const d = useApi<Detail>(`/api/v1/opportunities/${id}`);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [task, setTask] = useState({ title: "", dueAt: "" });

  async function save(patch: Record<string, unknown>) {
    if (!d.data) return;
    setSaving(true);
    try {
      await api(`/api/v1/opportunities/${id}`, { method: "PATCH", body: { expectedVersion: d.data.opportunity.version, ...patch } });
      toast.push("success", "Cambios guardados.");
      await d.reload();
      onChanged();
    } catch (e) {
      const err = e as ApiError;
      toast.push("error", err.message);
      if (err.status === 409) await d.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="opp-title">
      <button type="button" className="absolute inset-0 bg-ink/35" aria-label="Cerrar" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
          <h2 id="opp-title" className="font-display text-[17px] font-semibold">
            Oportunidad
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-surface-muted" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>
        {d.loading ? <SkeletonRows /> : null}
        {d.error ? <ErrorState description={d.error.message} onRetry={() => void d.reload()} /> : null}
        {d.data ? (
          <div className="flex flex-col gap-5 p-5">
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const amount = String(fd.get("amount") ?? "");
                void save({
                  title: fd.get("title"),
                  amount: amount === "" ? null : Number(amount),
                  currency: fd.get("currency"),
                  ownerUserId: fd.get("owner") || null,
                  followUpAt: fd.get("followUp") ? new Date(String(fd.get("followUp"))).toISOString() : null,
                });
              }}
            >
              <Field label="Título" className="col-span-2">
                {(p) => <Input {...p} name="title" defaultValue={d.data!.opportunity.title} disabled={!canWrite} required minLength={2} />}
              </Field>
              <Field label="Importe estimado">{(p) => <Input {...p} name="amount" inputMode="decimal" defaultValue={d.data!.opportunity.amount ?? ""} disabled={!canWrite} />}</Field>
              <Field label="Moneda">
                {(p) => (
                  <Select {...p} name="currency" defaultValue={d.data!.opportunity.currency} disabled={!canWrite}>
                    {["ARS", "USD", "EUR", "UYU", "CLP", "MXN", "BRL"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Responsable">
                {(p) => (
                  <Select {...p} name="owner" defaultValue={d.data!.opportunity.ownerUserId ?? ""} disabled={!canWrite}>
                    <option value="">Sin responsable</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Próximo seguimiento">
                {(p) => <Input {...p} type="date" name="followUp" defaultValue={d.data!.opportunity.followUpAt?.slice(0, 10) ?? ""} disabled={!canWrite} />}
              </Field>
              {canWrite ? (
                <div className="col-span-2 flex justify-end">
                  <Button type="submit" variant="secondary" loading={saving}>
                    Guardar cambios
                  </Button>
                </div>
              ) : null}
            </form>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Etapa</h3>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cambiar etapa">
                {d.data.stages.map((s) => {
                  const current = s.id === d.data!.opportunity.stageId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!canWrite || current || saving}
                      aria-pressed={current}
                      onClick={() => {
                        if (s.kind === "lost") {
                          const reason = window.prompt("Motivo de pérdida (opcional):") ?? "";
                          void save({ stageId: s.id, lostReason: reason || null });
                        } else void save({ stageId: s.id });
                      }}
                      className={
                        current
                          ? "rounded-full border border-ink bg-ink px-2.5 py-1 text-[12.5px] font-medium text-white"
                          : "rounded-full border border-border-strong px-2.5 py-1 text-[12.5px] text-fg-secondary hover:bg-surface-muted disabled:opacity-60"
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
              {d.data.opportunity.lostReason ? <p className="mt-2 text-[12.5px] text-fg-muted">Motivo de pérdida: {d.data.opportunity.lostReason}</p> : null}
            </section>

            <section className="rounded-md border border-border p-3 text-[13px]">
              <p className="font-medium">{d.data.contact?.name}</p>
              <p className="text-fg-muted tabular">{formatPhone(d.data.contact?.phoneE164)}</p>
              <div className="mt-2 flex gap-3 text-[12.5px]">
                {d.data.contact ? (
                  <Link href={`/contactos/${d.data.contact.id}`} className="underline underline-offset-2">
                    Ver contacto
                  </Link>
                ) : null}
                {d.data.opportunity.conversationId ? (
                  <Link href={`/conversaciones?c=${d.data.opportunity.conversationId}`} className="inline-flex items-center gap-1 underline underline-offset-2">
                    <MessagesSquare className="size-3.5" aria-hidden /> Abrir conversación
                  </Link>
                ) : null}
              </div>
              <p className="mt-2 text-[12px] text-fg-muted">
                Origen: {d.data.opportunity.source} · creada {formatDate(d.data.opportunity.createdAt)} · {formatMoney(d.data.opportunity.amount, d.data.opportunity.currency)}
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Tareas</h3>
              {d.data.tasks.length === 0 ? <p className="text-[13px] text-fg-muted">Sin tareas.</p> : null}
              <ul className="mb-2 flex flex-col gap-1.5">
                {d.data.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-[13px]">
                    <button
                      type="button"
                      disabled={!canTask || t.status !== "pending"}
                      onClick={async () => {
                        await api(`/api/v1/tasks/${t.id}`, { method: "PATCH", body: { status: "done" } }).catch((e: ApiError) => toast.push("error", e.message));
                        void d.reload();
                      }}
                      aria-label={`Completar tarea ${t.title}`}
                      className="text-fg-muted hover:text-success disabled:opacity-50"
                    >
                      <CheckCircle2 className={t.status === "done" ? "size-4 text-success" : "size-4"} />
                    </button>
                    <span className={t.status !== "pending" ? "text-fg-muted line-through" : ""}>{t.title}</span>
                    <span className="ml-auto text-[12px] text-fg-muted">{t.dueAt ? formatDate(t.dueAt) : ""}</span>
                  </li>
                ))}
              </ul>
              {canTask ? (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api("/api/v1/tasks", { body: { title: task.title, opportunityId: id, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null } });
                      setTask({ title: "", dueAt: "" });
                      void d.reload();
                    } catch (err) {
                      toast.push("error", (err as ApiError).message);
                    }
                  }}
                >
                  <Input aria-label="Nueva tarea" placeholder="Nueva tarea" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} required minLength={2} className="min-w-0 flex-1" />
                  <Input aria-label="Vencimiento" type="date" value={task.dueAt} onChange={(e) => setTask({ ...task, dueAt: e.target.value })} className="w-40" />
                  <Button type="submit" size="md">
                    Agregar
                  </Button>
                </form>
              ) : null}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Notas</h3>
              {canNote ? (
                <form
                  className="mb-2 flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api("/api/v1/notes", { body: { opportunityId: id, body: note } });
                      setNote("");
                      void d.reload();
                    } catch (err) {
                      toast.push("error", (err as ApiError).message);
                    }
                  }}
                >
                  <Textarea aria-label="Nueva nota" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota interna sobre esta oportunidad" required />
                  <Button type="submit" size="sm" className="self-end">
                    Guardar nota
                  </Button>
                </form>
              ) : null}
              <ul className="flex flex-col gap-2">
                {d.data.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-[#fde3a7] bg-warning-soft px-3 py-2 text-[13px]">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-[11.5px] text-fg-muted">
                      {n.authorName} · {formatDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Historial</h3>
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {d.data.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-1">
                    <Badge>{FIELD_LABEL[h.field] ?? h.field}</Badge>
                    <span className="text-fg-secondary">
                      {h.fromValue ? `${h.fromValue} → ` : ""}
                      {h.toValue ?? "—"}
                    </span>
                    <span className="text-fg-muted">
                      · {h.actorKind === "bot" ? "Bot" : h.actorKind === "system" ? "Sistema" : (h.actorName ?? "—")} · {formatDateTime(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
