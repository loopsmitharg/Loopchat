"use client";
import { useState } from "react";
import type { BotConfig } from "@/lib/bot-config";
import { modelCapabilities } from "@/lib/ai-capabilities";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useApi } from "@/lib/api-client";
import { Note, SaveBar, SectionCard, useSaveBot, type SectionProps } from "./shared";

type Conn = { id: string; provider: string; baseUrl: string | null; defaultModel: string; label: string };

/** Operación: parámetros del modelo (solo los compatibles), límites, fallas y reintentos. */
export function OperationSection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const conns = useApi<Conn[]>("/api/v1/ai-connections");
  const [o, setO] = useState<BotConfig["operation"]>(bot.config.operation);
  const conn = conns.data?.find((c) => c.id === bot.aiConnectionId);
  const model = bot.model || conn?.defaultModel || "";
  const caps = conn ? modelCapabilities(conn.provider, model, conn.baseUrl) : null;
  const dirty = JSON.stringify(o) !== JSON.stringify(bot.config.operation);
  const supportBadge = (s: "yes" | "no" | "try") => (s === "yes" ? <Badge tone="success">Admitido</Badge> : s === "no" ? <Badge tone="danger">No disponible para este modelo</Badge> : <Badge tone="warning">Se intenta</Badge>);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ config: { operation: o } });
      }}
    >
      <SectionCard title="Operación" description="Cómo se usa el modelo, qué pasa ante fallas y cuánto puede consumir. El proveedor y el modelo se eligen en General." footer={<SaveBar canEdit={canEdit} busy={busy} dirty={dirty} />}>
        {caps ? (
          <Note>
            {conn!.label} · <strong>{model}</strong>. {caps.note}
          </Note>
        ) : (
          <Note tone="warning">El bot no tiene proveedor de IA: los parámetros del modelo no aplican.</Note>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Creatividad (temperatura)" hint={caps ? supportBadge(caps.temperature) : undefined}>
            {(f) => (
              <Select {...f} value={o.temperature === null ? "" : String(o.temperature)} disabled={!canEdit || caps?.temperature === "no"} onChange={(e) => setO((x) => ({ ...x, temperature: e.target.value === "" ? null : Number(e.target.value) }))}>
                <option value="">Por defecto (0,3)</option>
                <option value="0">Muy precisa (0)</option>
                <option value="0.2">Precisa (0,2)</option>
                <option value="0.5">Equilibrada (0,5)</option>
                <option value="0.8">Creativa (0,8)</option>
              </Select>
            )}
          </Field>
          <Field label="Largo máximo de cada respuesta (tokens)" hint={caps ? supportBadge(caps.maxTokens) : undefined}>
            {(f) => (
              <Select {...f} value={o.maxResponseTokens === null ? "" : String(o.maxResponseTokens)} disabled={!canEdit} onChange={(e) => setO((x) => ({ ...x, maxResponseTokens: e.target.value === "" ? null : Number(e.target.value) }))}>
                <option value="">Por defecto (600)</option>
                <option value="300">300</option>
                <option value="600">600</option>
                <option value="1000">1000</option>
                <option value="2000">2000</option>
              </Select>
            )}
          </Field>
          <Field label="Reintentos ante fallas del proveedor" hint="Después de los reintentos, la conversación pasa a una persona.">
            {(f) => (
              <Select {...f} value={String(o.retries)} disabled={!canEdit} onChange={(e) => setO((x) => ({ ...x, retries: Number(e.target.value) }))}>
                <option value="1">Sin reintentos</option>
                <option value="2">1 reintento</option>
                <option value="3">2 reintentos</option>
              </Select>
            )}
          </Field>
          <Field label="Llamadas a la IA por conversación" hint="Al llegar al límite deriva a una persona, sin llamar a la IA. 0 = sin límite.">
            {(f) => <Input {...f} type="number" min={0} max={500} value={o.maxAiCallsPerConversation} disabled={!canEdit} onChange={(e) => setO((x) => ({ ...x, maxAiCallsPerConversation: Math.max(0, Math.min(500, Number(e.target.value) || 0)) }))} />}
          </Field>
        </div>
        <Field label="Si el bot falla">
          {(f) => (
            <Select {...f} value={o.onFailure} disabled={!canEdit} onChange={(e) => setO((x) => ({ ...x, onFailure: e.target.value as BotConfig["operation"]["onFailure"] }))}>
              <option value="handoff">Pasar a una persona (sin mensaje adicional)</option>
              <option value="message_and_handoff">Enviar un mensaje fijo y pasar a una persona</option>
            </Select>
          )}
        </Field>
        {o.onFailure === "message_and_handoff" ? (
          <Field label="Mensaje ante fallas" hint="Texto fijo, sin IA.">
            {(f) => <Textarea {...f} rows={2} maxLength={300} value={o.failureMessage} disabled={!canEdit} onChange={(e) => setO((x) => ({ ...x, failureMessage: e.target.value }))} placeholder="Tuvimos un inconveniente. Una persona del equipo te responde en breve." />}
          </Field>
        ) : null}
        <p className="text-[12px] text-fg-muted">El estado activo/inactivo y la publicación están arriba; los horarios de actividad, en “Horarios y reglas”.</p>
      </SectionCard>
    </form>
  );
}
