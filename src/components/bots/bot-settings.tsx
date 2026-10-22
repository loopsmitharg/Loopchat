"use client";
import { useState } from "react";
import { ArrowLeftRight, Bot, BookOpen, Clock, Flag, Gauge, Hand, KanbanSquare, ListChecks, Package, ScrollText, Sparkles, Target, Wrench } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useApi } from "@/lib/api-client";
import type { BotRow, Channel, Conn, Member, StageOpt } from "./settings/shared";
import { GeneralSection } from "./settings/section-general";
import { GoalsSection } from "./settings/section-goals";
import { PersonalitySection } from "./settings/section-personality";
import { RulesSection } from "./settings/section-rules";
import { KnowledgeSection } from "./settings/section-knowledge";
import { ProductsSection } from "./settings/section-products";
import { ToolsSection } from "./settings/section-tools";
import { PipelineSection } from "./settings/section-pipeline";
import { TransfersSection } from "./settings/section-transfers";
import { HandoffSection } from "./settings/section-handoff";
import { HoursSection } from "./settings/section-hours";
import { ObjectivesSection } from "./settings/section-objectives";
import { OperationSection } from "./settings/section-operation";
import { EffectiveSection } from "./settings/section-effective";

export type { BotRow };

/** Secciones agrupadas como la incorporación de un empleado: quién es, cómo habla, qué sabe, qué puede hacer, cuándo deriva. */
const GROUPS = [
  {
    label: "Quién es",
    items: [
      { id: "general", label: "Identidad", icon: Bot },
      { id: "goals", label: "Objetivos", icon: Flag },
      { id: "personality", label: "Personalidad y comportamiento", icon: Sparkles },
      { id: "rules", label: "Reglas de comportamiento", icon: ListChecks },
    ],
  },
  {
    label: "Qué sabe",
    items: [
      { id: "knowledge", label: "Conocimiento", icon: BookOpen },
      { id: "products", label: "Productos", icon: Package },
    ],
  },
  {
    label: "Qué puede hacer",
    items: [
      { id: "tools", label: "Herramientas y acciones", icon: Wrench },
      { id: "pipeline", label: "Pipeline asociado", icon: KanbanSquare },
      { id: "objectives", label: "Datos comerciales", icon: Target },
    ],
  },
  {
    label: "Cuándo deriva",
    items: [
      { id: "transfers", label: "Transferencias", icon: ArrowLeftRight },
      { id: "handoff", label: "Derivación humana", icon: Hand },
      { id: "hours", label: "Horarios y reglas", icon: Clock },
    ],
  },
  {
    label: "Funcionamiento",
    items: [
      { id: "operation", label: "Operación", icon: Gauge },
      { id: "effective", label: "Instrucciones efectivas", icon: ScrollText },
    ],
  },
] as const;
type SectionId = (typeof GROUPS)[number]["items"][number]["id"];

export function BotSettings({ bot, connections, channels, canEdit, onSaved, stages, companyHours }: { bot: BotRow; connections: Conn[]; channels: Channel[]; canEdit: boolean; onSaved: () => void; stages: StageOpt[]; companyHours: { enabled: boolean; summary: string; message: string } | null }) {
  const [section, setSection] = useState<SectionId>("general");
  const members = useApi<{ members: Member[] }>("/api/v1/members");
  const props = { bot, canEdit, onSaved };
  // al guardar se recarga el bot: la clave fuerza a los formularios a tomar los valores nuevos
  // (Productos maneja su propio estado: el catálogo no se reinicia al guardar)
  const k = section === "products" ? section : `${section}:${JSON.stringify(bot.config)}:${bot.allowedTools.join(",")}:${bot.handoffKeywords.join(",")}:${bot.instructions.length}:${bot.role}`;
  return (
    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Secciones de configuración" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-3 lg:overflow-visible lg:px-0">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex shrink-0 gap-1 lg:flex-col">
            <p className="hidden px-2.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted lg:block">{g.label}</p>
            {g.items.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={section === s.id ? "page" : undefined}
                onClick={() => setSection(s.id)}
                className={cn("flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium whitespace-nowrap", section === s.id ? "bg-brand-soft text-fg" : "text-fg-secondary hover:bg-surface-muted")}
              >
                <s.icon className="size-4 shrink-0" aria-hidden />
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div key={k} className="min-w-0">
        {section === "general" ? <GeneralSection {...props} connections={connections} channels={channels} /> : null}
        {section === "goals" ? <GoalsSection {...props} /> : null}
        {section === "personality" ? <PersonalitySection {...props} /> : null}
        {section === "rules" ? <RulesSection {...props} /> : null}
        {section === "knowledge" ? <KnowledgeSection {...props} /> : null}
        {section === "products" ? <ProductsSection {...props} /> : null}
        {section === "tools" ? <ToolsSection {...props} stages={stages} members={members.data?.members ?? []} /> : null}
        {section === "pipeline" ? <PipelineSection {...props} members={members.data?.members ?? []} /> : null}
        {section === "objectives" ? <ObjectivesSection {...props} /> : null}
        {section === "transfers" ? <TransfersSection {...props} /> : null}
        {section === "handoff" ? <HandoffSection {...props} members={members.data?.members ?? []} /> : null}
        {section === "hours" ? <HoursSection {...props} companyHours={companyHours} /> : null}
        {section === "operation" ? <OperationSection {...props} /> : null}
        {section === "effective" ? <EffectiveSection {...props} /> : null}
      </div>
    </div>
  );
}
