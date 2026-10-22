"use client";
import Link from "next/link";
import { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Note, SaveBar, SectionCard, useSaveBot, type SectionProps } from "./shared";

const OPTIONS = [
  { id: "respond", label: "Responder normalmente", help: "El bot atiende igual que en horario." },
  { id: "message_and_continue", label: "Avisar y seguir atendiendo", help: "Envía el aviso (una vez por día) y el bot sigue respondiendo; aclara que una persona atiende en horario hábil." },
  { id: "message_and_handoff", label: "Avisar y derivar al equipo", help: "Envía el aviso y deja la conversación en “Pide humano” para el próximo horario." },
] as const;

export function HoursSection({ bot, canEdit, onSaved, companyHours }: SectionProps & { companyHours: { enabled: boolean; summary: string; message: string } | null }) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const [h, setH] = useState(bot.config.hours);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ config: { hours: h } });
      }}
    >
      <SectionCard title="Horarios y reglas" description="Comportamiento fuera del horario de atención y límite de consultas sin resolver." footer={<SaveBar canEdit={canEdit} busy={busy} />}>
        <Note tone={companyHours?.enabled ? "neutral" : "warning"}>
          {companyHours?.enabled ? `Horario de atención de la empresa: ${companyHours.summary}.` : "La empresa no tiene horario de atención configurado: se considera siempre abierta."}{" "}
          <Link href="/configuracion/empresa" className="font-medium underline underline-offset-2">
            Cambiar horario
          </Link>
        </Note>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Fuera de horario</legend>
          {OPTIONS.map((o) => (
            <label key={o.id} className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="ooh" className="mt-0.5" checked={h.outOfHours === o.id} disabled={!canEdit} onChange={() => setH((x) => ({ ...x, outOfHours: o.id }))} />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-[12px] text-fg-muted">{o.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {h.outOfHours !== "respond" ? (
          <Field label="Aviso fuera de horario" hint="Texto fijo, sin IA. Vacío = usa el mensaje de la empresa.">
            {(f) => <Textarea {...f} rows={2} maxLength={500} value={h.outOfHoursMessage} disabled={!canEdit} onChange={(e) => setH((x) => ({ ...x, outOfHoursMessage: e.target.value }))} placeholder={companyHours?.message || "Estamos fuera de nuestro horario de atención. Te respondemos apenas volvamos."} />}
          </Field>
        ) : null}
        <Field label="Consultas seguidas sin resolver antes de derivar" hint="Si el bot no puede responder esta cantidad de veces seguidas, pasa la conversación a una persona. 0 = sin límite.">
          {(f) => <Input {...f} type="number" min={0} max={10} className="max-w-28" value={h.maxUnresolvedAttempts} disabled={!canEdit} onChange={(e) => setH((x) => ({ ...x, maxUnresolvedAttempts: Math.max(0, Math.min(10, Number(e.target.value) || 0)) }))} />}
        </Field>
      </SectionCard>
    </form>
  );
}
