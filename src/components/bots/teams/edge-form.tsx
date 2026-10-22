"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { INTENT_LABELS, TEAM_INTENTS, type RouteCondition, type TeamIntent } from "@/lib/team/types";

/** Editor de la condición de una derivación (necesidad detectada, palabras clave o IA). */
export function ConditionForm({ value, onChange, disabled }: { value: RouteCondition; onChange: (c: RouteCondition) => void; disabled?: boolean }) {
  const [kwText, setKwText] = useState(value.kind === "keywords" ? value.keywords.join(", ") : "");
  return (
    <div className="flex flex-col gap-3">
      <Field label="Cuándo derivar" hint={value.kind === "ai" ? "Solo se consulta a la IA si las reglas sin IA no alcanzan. Consume la API de tu empresa." : "Se evalúa sin IA: no consume tokens."}>
        {(p) => (
          <Select
            {...p}
            value={value.kind}
            disabled={disabled}
            onChange={(e) => {
              const k = e.target.value as RouteCondition["kind"];
              onChange(k === "intent" ? { kind: "intent", intents: [] } : k === "keywords" ? { kind: "keywords", keywords: [] } : { kind: "ai", description: "" });
              setKwText("");
            }}
          >
            <option value="intent">Según la necesidad del cliente</option>
            <option value="keywords">Si el mensaje tiene ciertas palabras</option>
            <option value="ai">Lo decide la IA (descripción)</option>
          </Select>
        )}
      </Field>
      {value.kind === "intent" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Necesidades</legend>
          {TEAM_INTENTS.filter((i) => i !== "consulta").map((i) => (
            <label key={i} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.intents.includes(i)}
                disabled={disabled}
                onChange={(e) => onChange({ kind: "intent", intents: e.target.checked ? [...value.intents, i] : value.intents.filter((x: TeamIntent) => x !== i) })}
              />
              {INTENT_LABELS[i]}
            </label>
          ))}
          <p className="text-[12px] text-fg-muted">Un reclamo o una falla tiene prioridad sobre una venta, aunque el cliente mencione un precio.</p>
        </fieldset>
      ) : null}
      {value.kind === "keywords" ? (
        <Field label="Palabras o frases" hint="Separadas por coma. Sin importar mayúsculas ni tildes.">
          {(p) => (
            <Input
              {...p}
              value={kwText}
              disabled={disabled}
              placeholder="Ej.: garantía, service, factura"
              onChange={(e) => {
                setKwText(e.target.value);
                onChange({
                  kind: "keywords",
                  keywords: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 30),
                });
              }}
            />
          )}
        </Field>
      ) : null}
      {value.kind === "ai" ? (
        <Field label="Describí cuándo derivar" hint="Ej.: el cliente quiere reservar una visita técnica a domicilio.">
          {(p) => <Textarea {...p} rows={3} maxLength={300} value={value.description} disabled={disabled} onChange={(e) => onChange({ kind: "ai", description: e.target.value })} />}
        </Field>
      ) : null}
    </div>
  );
}
