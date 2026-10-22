"use client";
import Link from "next/link";
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Note, SaveBar, SectionCard, Toggle, useSaveBot, type SectionProps } from "./shared";

export function KnowledgeSection({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const sources = useApi<{ id: string; status: string; title: string; kind: string }[]>("/api/v1/knowledge");
  const [mode, setMode] = useState(bot.config.knowledge.mode);
  const [ids, setIds] = useState(bot.config.knowledge.sourceIds);
  const [useKnowledge, setUseKnowledge] = useState(bot.allowedTools.includes("use_knowledge"));
  const [memory, setMemory] = useState(bot.config.memory.enabled);
  const ready = (sources.data ?? []).filter((s) => s.status === "ready").length;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const tools = new Set(bot.allowedTools);
        if (useKnowledge) tools.add("use_knowledge");
        else tools.delete("use_knowledge");
        const valid = ids.filter((i) => (sources.data ?? []).some((s) => s.id === i));
        void save({ ...(bot.mode === "instructions" ? { allowedTools: [...tools] } : {}), config: { memory: { enabled: memory }, knowledge: { mode, sourceIds: valid } } });
      }}
    >
      <SectionCard title="Conocimiento y memoria" description="Qué información de la empresa y del cliente puede consultar el bot para responder." footer={<SaveBar canEdit={canEdit} busy={busy} />}>
        {bot.mode === "instructions" ? (
          <Toggle checked={useKnowledge} disabled={!canEdit} onChange={setUseKnowledge} label="Consultar preguntas frecuentes y documentos" description="El bot busca en el conocimiento de la empresa los fragmentos relevantes para cada mensaje." />
        ) : (
          <Note>En los bots de flujo visual, la consulta de conocimiento se habilita en cada paso de IA del flujo.</Note>
        )}
        <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-[13px]">
          <BookOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex-1">{sources.loading ? "Cargando fuentes…" : `${ready} fuente(s) de conocimiento lista(s) en la empresa.`}</span>
          <Link href="/configuracion/conocimiento" className="text-[12.5px] font-medium underline underline-offset-2">
            Administrar conocimiento
          </Link>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">Fuentes que puede consultar este bot</legend>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="kmode" checked={mode === "all"} disabled={!canEdit} onChange={() => setMode("all")} /> Todo el conocimiento de la empresa
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="radio" name="kmode" checked={mode === "selected"} disabled={!canEdit} onChange={() => setMode("selected")} /> Solo las fuentes que elija (restricción de acceso)
          </label>
          {mode === "selected" ? (
            <ul className="ml-6 flex flex-col gap-1">
              {(sources.data ?? [])
                .filter((s) => s.status === "ready")
                .map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={ids.includes(s.id)} disabled={!canEdit} onChange={(e) => setIds((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                      {s.title} <span className="text-[12px] text-fg-muted">({s.kind === "faq" ? "pregunta frecuente" : s.kind === "file" ? "documento" : "texto"})</span>
                    </label>
                  </li>
                ))}
              {mode === "selected" && !ids.length ? <li className="text-[12.5px] text-warning">Sin fuentes elegidas: el bot no va a consultar conocimiento.</li> : null}
            </ul>
          ) : null}
        </fieldset>
        <Toggle
          checked={memory}
          disabled={!canEdit}
          onChange={setMemory}
          label="Memoria comercial del CRM"
          description="Suma un resumen acotado del cliente: oportunidades abiertas y su etapa, tareas pendientes, última interacción y productos consultados. Nunca envía el historial completo ni datos de otras empresas."
        />
      </SectionCard>
    </form>
  );
}
