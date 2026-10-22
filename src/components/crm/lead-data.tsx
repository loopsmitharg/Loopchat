"use client";
import { useState } from "react";
import { Bot, Check, Pencil, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

export type LeadValue = { key: string; label: string; type: "text" | "number" | "choice"; options: string[]; value: string | null; source: "bot" | "user" | null; updatedAt: string | null };

/** Datos comerciales del contacto: obtenidos (con origen) y pendientes; editables por el equipo. */
export function LeadDataList({ contactId, values, canEdit, onChanged }: { contactId: string; values: LeadValue[]; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (!values.length) return <p className="text-[12.5px] text-fg-muted">La empresa no definió datos comerciales (se configuran en Chatbots → Objetivos comerciales).</p>;
  const pending = values.filter((v) => !v.value).length;

  async function saveValue(key: string, value: string | null) {
    try {
      await api(`/api/v1/contacts/${contactId}/lead-data`, { method: "PUT", body: { key, value } });
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pending ? <p className="text-[12px] text-fg-muted">{pending} dato(s) pendiente(s).</p> : <p className="text-[12px] text-success">Todos los datos obtenidos.</p>}
      <dl className="flex flex-col gap-1">
        {values.map((v) => (
          <div key={v.key} className="flex items-start gap-2 text-[13px]">
            <dt className="w-[42%] shrink-0 text-fg-muted">{v.label}</dt>
            <dd className="min-w-0 flex-1">
              {editing === v.key ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveValue(v.key, draft.trim() || null);
                  }}
                >
                  {v.type === "choice" ? (
                    <select value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 min-w-0 flex-1 rounded border border-border-strong bg-surface px-1 text-[12.5px]" aria-label={v.label}>
                      <option value="">(vacío)</option>
                      {v.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} inputMode={v.type === "number" ? "decimal" : undefined} maxLength={200} className="h-7 min-w-0 flex-1 rounded border border-border-strong bg-surface px-1.5 text-[12.5px]" aria-label={v.label} autoFocus />
                  )}
                  <button type="submit" className="rounded p-1 hover:bg-surface-muted" aria-label="Guardar">
                    <Check className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded p-1 hover:bg-surface-muted" aria-label="Cancelar">
                    <X className="size-3.5" />
                  </button>
                </form>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {v.value ? <span className="font-medium">{v.value}</span> : <span className="text-fg-muted italic">pendiente</span>}
                  {v.source === "bot" ? <Bot className="size-3 text-secondary-strong" aria-label="Obtenido por el bot" /> : null}
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(v.value ?? "");
                        setEditing(v.key);
                      }}
                      className="rounded p-0.5 text-fg-muted hover:bg-surface-muted hover:text-fg"
                      aria-label={`Editar ${v.label}`}
                    >
                      <Pencil className="size-3" />
                    </button>
                  ) : null}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
