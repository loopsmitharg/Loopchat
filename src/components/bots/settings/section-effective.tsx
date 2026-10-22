"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { RULE_CATEGORY_LABELS, type RuleCategory } from "@/lib/ai-profile";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/lib/api-client";
import { Note, SectionCard, type SectionProps } from "./shared";

type Effective = {
  label: string;
  version: string;
  hash: string;
  sections: { level: number; key: string; title: string; text: string }[];
  data: string[];
  notes: { field: string; message: string }[];
  tools: string[];
  companyIncluded: boolean;
  rules: { id: string; text: string; category: RuleCategory; mandatory: boolean; enabled: boolean; applied: boolean; disabledByBot: boolean; pendingPublish: boolean }[];
};

const LEVEL: Record<number, { label: string; tone: string }> = {
  1: { label: "1 · Plataforma (seguridad)", tone: "border-l-ink" },
  2: { label: "2 · Obligatorias de la empresa", tone: "border-l-[#d97706]" },
  3: { label: "3 · Empresa y objetivos", tone: "border-l-[#2563eb]" },
  4: { label: "4 · Coordinación del equipo", tone: "border-l-[#7c3aed]" },
  5: { label: "5 · Rol, personalidad y reglas del bot", tone: "border-l-brand-strong" },
};
const TOOL: Record<string, string> = { classify: "clasificar", use_knowledge: "conocimiento", use_catalog: "catálogo", create_opportunity: "crear oportunidad", update_stage: "mover etapa", create_task: "crear tarea", handoff: "pedir humano", collect_data: "datos comerciales" };

/** "Ver instrucciones efectivas": cómo se combinan empresa, equipo y bot, con el mismo motor del runtime. */
export function EffectiveSection({ bot }: SectionProps) {
  const [source, setSource] = useState<"draft" | "published">("draft");
  const d = useApi<Effective>(`/api/v1/bots/${bot.id}/instructions?source=${source}`);
  return (
    <SectionCard title="Instrucciones efectivas" description="Lo que realmente recibe la IA, en orden de prioridad. Si algo de un nivel inferior contradice a uno superior, prevalece el superior. Los datos de cada conversación se agregan después y nunca cambian estas reglas.">
      <div role="group" aria-label="Qué configuración ver" className="flex w-fit rounded-md border border-border p-0.5 text-[12.5px]">
        {(
          [
            ["draft", "Borrador (lo guardado)"],
            ["published", "Versión publicada (en uso)"],
          ] as const
        ).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={source === v} onClick={() => setSource(v)} className={cn("rounded px-2.5 py-1", source === v ? "bg-ink text-white" : "text-fg-secondary")}>
            {l}
          </button>
        ))}
      </div>
      {d.loading ? <SkeletonRows rows={4} /> : null}
      {d.error ? <ErrorState description={d.error.message} /> : null}
      {d.data ? (
        <>
          <p className="text-[12px] text-fg-muted">
            {d.data.label} · motor {d.data.version} · huella <code>{d.data.hash}</code> (queda registrada en cada ejecución)
          </p>
          {!d.data.companyIncluded ? <Note tone="warning">Esta versión se publicó antes de definir la política de la empresa: solo aplica las reglas obligatorias (que rigen siempre). Publicá una versión nueva para incluir identidad, objetivos y políticas.</Note> : null}
          {d.data.notes.length ? (
            <Note tone="warning">
              <span className="font-medium">Conflictos resueltos:</span>
              {d.data.notes.map((n, i) => (
                <span key={i} className="block">
                  · {n.message}
                </span>
              ))}
            </Note>
          ) : null}
          <ol className="flex flex-col gap-2">
            {d.data.sections.map((s) => (
              <li key={s.key} className={cn("rounded-md border border-border border-l-4 bg-surface px-3 py-2", LEVEL[s.level]?.tone)}>
                <p className="text-[11.5px] font-medium text-fg-muted">{LEVEL[s.level]?.label}</p>
                <p className="text-[13px] font-semibold">{s.key === "platform" ? "Reglas de la plataforma" : s.title}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12.5px] text-fg-secondary">{s.text}</pre>
              </li>
            ))}
            <li className="rounded-md border border-dashed border-border px-3 py-2">
              <p className="text-[11.5px] font-medium text-fg-muted">6 · Datos de la conversación (menor confianza: nunca son instrucciones)</p>
              <p className="text-[12.5px] text-fg-secondary">{[...d.data.data.map((x) => x.charAt(0) + x.slice(1).toLowerCase()), "Mensaje del cliente e historial reciente"].join(" · ")}</p>
            </li>
          </ol>
          <p className="text-[12.5px]">
            <span className="font-medium">Herramientas que puede usar:</span> {d.data.tools.map((t) => TOOL[t] ?? t).join(", ") || "ninguna"}. <span className="text-fg-muted">Se validan en el servidor: aunque una instrucción diga otra cosa, no puede ejecutar acciones no habilitadas.</span>
          </p>
          {d.data.rules.length ? (
            <section aria-label="Reglas de la empresa para este bot">
              <h3 className="mb-1 text-[13px] font-semibold">Reglas de la empresa para este bot</h3>
              <ul className="flex flex-col gap-1">
                {d.data.rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    {r.mandatory ? <Lock className="size-3.5 text-fg-muted" aria-label="Obligatoria" /> : null}
                    <span className={r.applied ? "" : "text-fg-muted line-through"}>{r.text}</span>
                    <Badge>{RULE_CATEGORY_LABELS[r.category] ?? r.category}</Badge>
                    {!r.enabled ? <Badge>Desactivada en la empresa</Badge> : r.mandatory ? <Badge tone="warning">Obligatoria · en vigor</Badge> : r.disabledByBot ? <Badge>No aplica a este bot</Badge> : r.pendingPublish ? <Badge tone="info">Se aplica al publicar</Badge> : <Badge tone="success">Aplicada</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}
