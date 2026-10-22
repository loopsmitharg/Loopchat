"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Note, SaveBar, SectionCard, toTerms, Toggle, useSaveBot, type Member, type SectionProps } from "./shared";

const LANGS = ["Español", "Inglés", "Portugués", "Italiano", "Francés", "Alemán"];
const SUGGESTED = "Voy a derivar tu conversación a una persona de nuestro equipo.";

export function HandoffSection({ bot, canEdit, onSaved, members }: SectionProps & { members: Member[] }) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const [h, setH] = useState(bot.config.handoff);
  const [autoResume, setAutoResume] = useState(bot.config.control.autoResume);
  const [keywords, setKeywords] = useState(bot.handoffKeywords.join(", "));
  const [extra, setExtra] = useState(h.extraInsultTerms.join(", "));
  const [ignored, setIgnored] = useState(h.ignoredInsultTerms.join(", "));
  const assignable = members.filter((m) => m.status === "active" && m.role !== "viewer");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          ...(bot.mode === "instructions" ? { handoffKeywords: toTerms(keywords) } : {}),
          config: { handoff: { ...h, extraInsultTerms: toTerms(extra), ignoredInsultTerms: toTerms(ignored) }, control: { autoResume } },
        });
      }}
    >
      <SectionCard title="Derivación humana" description="Cuándo el bot deja de responder y pasa la conversación a una persona del equipo." footer={<SaveBar canEdit={canEdit} busy={busy} />}>
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              checked={h.insultDetection}
              disabled={!canEdit}
              onChange={(v) => setH((x) => ({ ...x, insultDetection: v }))}
              label="Derivar automáticamente ante insultos o agresiones verbales"
              description="Antes de llamar a la IA se revisa el mensaje con reglas y diccionarios locales. Si hay un insulto o agresión, el bot no responde: la conversación pasa a “Pide humano”."
            />
            <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />} className="ml-auto">
              No consume tu API de IA
            </Badge>
          </div>
          <p className="text-[12px] text-fg-muted">
            Idiomas cubiertos: {LANGS.join(", ")}. Reconoce mayúsculas, tildes, letras repetidas, espacios intercalados, símbolos y números en lugar de letras. Ignora citas entre comillas, negaciones y usos comunes (“burro de arranque”, “bolsas de basura”). Ningún mensaje se envía a servicios externos de moderación.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Términos extra a considerar ofensivos" hint="Separados por coma. Ej.: insultos regionales o de tu rubro.">
              {(f) => <Input {...f} value={extra} disabled={!canEdit || !h.insultDetection} onChange={(e) => setExtra(e.target.value)} />}
            </Field>
            <Field label="Términos a ignorar" hint="Separados por coma. Los títulos de tus productos ya se ignoran solos.">
              {(f) => <Input {...f} value={ignored} disabled={!canEdit || !h.insultDetection} onChange={(e) => setIgnored(e.target.value)} />}
            </Field>
          </div>
        </div>
        {bot.mode === "instructions" ? (
          <Field label="Palabras clave que derivan a una persona" hint="Separadas por coma. Si el mensaje contiene alguna, se deriva sin llamar a la IA.">
            {(f) => <Input {...f} value={keywords} disabled={!canEdit} onChange={(e) => setKeywords(e.target.value)} />}
          </Field>
        ) : null}
        <Toggle checked={h.allowAiHandoff} disabled={!canEdit} onChange={(v) => setH((x) => ({ ...x, allowAiHandoff: v }))} label="La IA puede pedir una persona" description="Cuando el cliente pide hablar con alguien, está molesto o la consulta excede lo que el bot sabe." />
        <Field label="Mensaje fijo de transferencia (opcional)" hint="Plantilla estática, sin IA. Vacío = no se envía mensaje al derivar.">
          {(f) => (
            <div className="flex flex-col gap-1.5">
              <Textarea {...f} rows={2} maxLength={500} value={h.transferMessage} disabled={!canEdit} onChange={(e) => setH((x) => ({ ...x, transferMessage: e.target.value }))} placeholder={SUGGESTED} />
              {canEdit && !h.transferMessage ? (
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setH((x) => ({ ...x, transferMessage: SUGGESTED }))}>
                  Usar el texto sugerido
                </Button>
              ) : null}
            </div>
          )}
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Responsable al derivar" hint="Si la conversación ya tiene responsable, se respeta.">
            {(f) => (
              <Select {...f} value={h.assignToUserId ?? ""} disabled={!canEdit} onChange={(e) => setH((x) => ({ ...x, assignToUserId: e.target.value || null }))}>
                <option value="">Sin asignar (queda en “Pide humano” para el equipo)</option>
                {assignable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Volver a activar el bot">
            {(f) => (
              <Select {...f} value={autoResume} disabled={!canEdit} onChange={(e) => setAutoResume(e.target.value as typeof autoResume)}>
                <option value="never">Solo manualmente (“Reanudar bot”)</option>
                <option value="on_resolve">Automáticamente al marcar la conversación como resuelta</option>
              </Select>
            )}
          </Field>
        </div>
        <Toggle checked={h.notifyTeam} disabled={!canEdit} onChange={(v) => setH((x) => ({ ...x, notifyTeam: v }))} label="Avisar al equipo con una tarea" description="Crea una tarea “Atender conversación derivada” para el responsable (o sin asignar) con el motivo." />
        <Toggle checked disabled onChange={() => undefined} label="Pausar la IA cuando interviene una persona (siempre activo)" description="Cuando alguien responde, el bot se detiene y se descartan respuestas pendientes o tardías del modelo. Así nunca hay respuestas cruzadas." />
        <Note>El motivo de cada derivación queda registrado (insultos: insult_detection) y se muestra al vendedor en la conversación y en Ejecuciones.</Note>
      </SectionCard>
    </form>
  );
}
