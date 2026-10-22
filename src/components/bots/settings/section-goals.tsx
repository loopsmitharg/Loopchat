"use client";
import Link from "next/link";
import { useState } from "react";
import { COMPANY_GOAL_LABELS, type CompanyProfile } from "@/lib/ai-profile";
import { BOT_METRICS, type BotConfig } from "@/lib/bot-config";
import { goalCatalog, allGoals, METRIC_LABELS } from "@/lib/instructions/catalog";
import { ROLE_TEMPLATES } from "@/lib/team/roles";
import { useApi } from "@/lib/api-client";
import { MultiChoice, PhraseList } from "./persona-controls";
import { Note, SaveBar, SectionCard, useSaveBot, type SectionProps } from "./shared";

/** ¿Qué tiene que lograr este chatbot? Objetivos por rol, propios e indicadores. */
export function GoalsSection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const profile = useApi<{ profile: CompanyProfile }>("/api/v1/ai-profile");
  const [id, setId] = useState<BotConfig["identity"]>(bot.config.identity);
  const catalog = goalCatalog(bot.role);
  // objetivos elegidos que no son del rol actual (por ejemplo, si cambió el rol) se siguen mostrando
  const extra = allGoals().filter((g) => id.goals.includes(g.key) && !catalog.some((c) => c.key === g.key));
  const options = [...catalog, ...extra].map((g) => ({ value: g.key, label: g.label }));
  const co = profile.data?.profile.objectives;
  const dirty = JSON.stringify(id) !== JSON.stringify(bot.config.identity);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ config: { identity: { goals: id.goals, customGoals: id.customGoals, metrics: id.metrics } } });
      }}
    >
      <SectionCard title="¿Qué tiene que lograr este chatbot?" description="Su objetivo propio, dentro de su función. El primero que elijas es el principal." footer={<SaveBar canEdit={canEdit} busy={busy} dirty={dirty} />}>
        {co?.primary ? (
          <Note tone="info">
            Objetivo de la empresa: <strong>{co.primary === "custom" && co.customGoal ? co.customGoal : COMPANY_GOAL_LABELS[co.primary]}</strong>. Este bot lo aplica solo dentro de su función ({ROLE_TEMPLATES[bot.role]?.label ?? bot.role}): por ejemplo, soporte no vende durante un reclamo.{" "}
            <Link href="/configuracion/identidad-ia" className="underline">
              Cambiar
            </Link>
          </Note>
        ) : null}
        {options.length ? (
          <MultiChoice legend={`Objetivos sugeridos para ${ROLE_TEMPLATES[bot.role]?.label ?? "este rol"}`} value={id.goals} options={options} onChange={(v) => setId((x) => ({ ...x, goals: v }))} disabled={!canEdit} max={10} hint={id.goals[0] ? `Principal: ${options.find((o) => o.value === id.goals[0])?.label}` : "Sin objetivos elegidos."} />
        ) : (
          <p className="text-[13px] text-fg-muted">El rol personalizado no tiene objetivos sugeridos: escribí los tuyos.</p>
        )}
        <PhraseList label="Objetivos propios" value={id.customGoals} onChange={(v) => setId((x) => ({ ...x, customGoals: v }))} disabled={!canEdit} placeholder="Ej.: conseguir que el cliente agende una visita al local" max={10} />
        <MultiChoice legend="Indicadores a seguir" value={id.metrics} options={BOT_METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] }))} onChange={(v) => setId((x) => ({ ...x, metrics: v }))} disabled={!canEdit} hint="Se muestran en Ejecuciones. No son instrucciones: el bot nunca inventa resultados ni presiona al cliente para cumplirlos." />
      </SectionCard>
    </form>
  );
}
