"use client";
import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Selector visual de una opción (tarjetas tipo radio, accesible con teclado). */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  disabled,
  allowNone,
  noneLabel = "Sin definir",
  hint,
  columns = 5,
}: {
  legend: string;
  value: T | null;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  hint?: ReactNode;
  columns?: 2 | 3 | 4 | 5;
}) {
  const name = useId();
  const all = allowNone ? [{ value: "" as T, label: noneLabel, hint: undefined }, ...options] : options;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-medium text-fg-secondary">{legend}</legend>
      <div className={cn("grid gap-1.5", columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3 xl:grid-cols-5")}>
        {all.map((o) => {
          const checked = (value ?? "") === o.value;
          return (
            <label key={o.value === "" ? "__unset" : o.value} className={cn("flex min-w-0 cursor-pointer flex-col rounded-md border px-2.5 py-1.5 text-[12.5px]", checked ? "border-brand-strong bg-brand-soft/60" : "border-border hover:bg-surface-muted", disabled && "cursor-not-allowed opacity-70")}>
              <span className="flex items-center gap-1.5 font-medium">
                <input type="radio" name={name} checked={checked} disabled={disabled} onChange={() => onChange((o.value || null) as T | null)} />
                {o.label}
              </span>
              {o.hint ? <span className="text-[11.5px] text-fg-muted">{o.hint}</span> : null}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-[12px] text-fg-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** Selección múltiple con tope (chips con casilla). */
export function MultiChoice<T extends string>({ legend, value, options, onChange, disabled, max, hint }: { legend: string; value: T[]; options: { value: T; label: string }[]; onChange: (v: T[]) => void; disabled?: boolean; max?: number; hint?: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-medium text-fg-secondary">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          const blocked = !on && max !== undefined && value.length >= max;
          return (
            <label key={o.value} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", on ? "border-brand-strong bg-brand-soft/60 font-medium" : "border-border hover:bg-surface-muted", (disabled || blocked) && "cursor-not-allowed opacity-60")}>
              <input type="checkbox" className="size-3.5" checked={on} disabled={disabled || blocked} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-[12px] text-fg-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** Lista editable de frases cortas (reglas, expresiones). */
export function PhraseList({ label, value, onChange, disabled, placeholder, max = 20, maxLength = 200 }: { label: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string; max?: number; maxLength?: number }) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const add = () => {
    const t = draft.trim();
    if (t.length < 2 || value.includes(t) || value.length >= max) return;
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg-secondary">
        {label}
      </label>
      {value.length ? (
        <ul className="flex flex-col gap-1">
          {value.map((v, i) => (
            <li key={`${v}-${i}`} className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 break-words">{v}</span>
              {!disabled ? (
                <button type="button" aria-label={`Quitar: ${v}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-0.5 text-fg-muted hover:bg-surface-muted hover:text-fg">
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled && value.length < max ? (
        <div className="flex gap-2">
          <input
            id={id}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="h-9 min-w-0 flex-1 rounded-[var(--radius-ctl)] border border-border-strong bg-surface px-3 text-sm placeholder:text-fg-muted/80 focus:border-brand-strong focus:outline-none focus:ring-2 focus:ring-brand/45"
          />
          <button type="button" onClick={add} className="h-9 shrink-0 rounded-md border border-border-strong bg-surface px-3 text-[13px] hover:bg-surface-muted">
            Agregar
          </button>
        </div>
      ) : null}
    </div>
  );
}
