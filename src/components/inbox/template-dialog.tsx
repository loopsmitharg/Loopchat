"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { api, ApiError } from "@/lib/api-client";

type Template = { name: string; language: string; category: string; body: string; params: number; available: boolean; unavailableReason: string | null };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const render = (body: string, values: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => values[Number(n) - 1]?.trim() || `{{${n}}}`);
const keyOf = (t: Template) => `${t.name}|${t.language}`;

/** Reabrir una conversación fuera de la ventana de 24 h con una plantilla aprobada por Meta. */
export function TemplateDialog({ conversationId, open, onClose, onSent, onError }: { conversationId: string; open: boolean; onClose: () => void; onSent: () => void; onError: (m: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState("");
  // datos por plantilla: cambiar de plantilla no mezcla los valores
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [sending, setSending] = useState(false);
  const keyRef = useRef(newKey());

  const apply = (list: Template[]) => {
    setTemplates(list);
    const first = list.find((t) => t.available);
    setSelected((s) => (s && list.some((t) => keyOf(t) === s) ? s : first ? keyOf(first) : ""));
  };
  const fetchList = (sync: boolean) => api<{ templates: Template[] }>(`/api/v1/conversations/${conversationId}/templates${sync ? "?sync=1" : ""}`).then((r) => r.templates);

  useEffect(() => {
    if (!open || templates !== null) return;
    fetchList(false)
      .then(apply)
      .catch((e: ApiError) => {
        onError(e.message);
        setTemplates([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga única al abrir
  }, [open]);

  async function refresh() {
    setSyncing(true);
    try {
      apply(await fetchList(true));
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setSyncing(false);
    }
  }

  const tpl = templates?.find((t) => keyOf(t) === selected) ?? null;
  const current = tpl ? Array.from({ length: tpl.params }, (_, i) => values[selected]?.[i] ?? "") : [];
  const complete = Boolean(tpl?.available) && current.every((v) => v.trim());

  async function send() {
    if (!tpl || !complete || sending) return;
    setSending(true);
    try {
      await api(`/api/v1/conversations/${conversationId}/templates`, { body: { name: tpl.name, language: tpl.language, params: current.map((v) => v.trim()), idempotencyKey: keyRef.current } });
      keyRef.current = newKey();
      onSent();
      onClose();
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar plantilla de WhatsApp"
      description="Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada por Meta. La conversación se cobra a la cuenta de Meta de la empresa."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={sending} disabled={!complete}>
            Enviar plantilla
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Plantilla" hint={templates && !templates.length ? "No hay plantillas aprobadas para este número. Crealas en el Administrador de WhatsApp de Meta y actualizá la lista." : undefined}>
              {(f) => (
                <Select {...f} value={selected} disabled={templates === null || !templates.length} onChange={(e) => setSelected(e.target.value)}>
                  {templates === null ? <option value="">Cargando…</option> : null}
                  {(templates ?? []).map((t) => (
                    <option key={keyOf(t)} value={keyOf(t)} disabled={!t.available}>
                      {t.name} ({t.language}){t.available ? "" : " — no disponible"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button variant="outline" onClick={() => void refresh()} loading={syncing} aria-label="Actualizar plantillas desde Meta">
            <RefreshCw className="size-4" aria-hidden />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        </div>
        {tpl && !tpl.available ? <p className="text-[12.5px] text-warning">{tpl.unavailableReason}</p> : null}
        {tpl?.available
          ? current.map((v, i) => (
              <Field key={`${selected}-${i}`} label={`Dato {{${i + 1}}}`}>
                {(f) => <Input {...f} value={v} maxLength={1024} onChange={(e) => setValues((x) => ({ ...x, [selected]: current.map((y, j) => (j === i ? e.target.value : y)) }))} />}
              </Field>
            ))
          : null}
        {tpl ? (
          <div>
            <p className="mb-1 text-[12px] font-medium text-fg-secondary">Vista previa</p>
            <p className="whitespace-pre-wrap rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px]">{render(tpl.body, current)}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
