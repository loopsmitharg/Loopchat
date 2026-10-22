"use client";
import { useId, useState, type ReactNode } from "react";
import type { BotConfig, BotConfigPatch } from "@/lib/bot-config";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

export type BotRow = {
  id: string;
  name: string;
  role: "receptionist" | "sales" | "customer_service" | "support" | "followup" | "aftersales" | "custom";
  mode: "instructions" | "flow";
  status: string;
  aiConnectionId: string | null;
  model: string | null;
  instructions: string;
  allowedTools: string[];
  handoffKeywords: string[];
  channelConnectionId: string | null;
  publishedVersionId: string | null;
  config: BotConfig;
  productIds: string[];
};

export type Member = { userId: string; name: string; email: string; role: string; status: string };
export type Conn = { id: string; label: string; provider: string; defaultModel: string; status: string };
export type Channel = { id: string; displayName: string; phoneNumber: string };
export type StageOpt = { id: string; name: string; kind?: string; pipelineName?: string };

export type SectionProps = { bot: BotRow; canEdit: boolean; onSaved: () => void };

/** Guarda una parte de la configuración (PATCH parcial). Lo guardado se aplica al publicar. */
export function useSaveBot(bot: BotRow, onSaved: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(body: { config?: BotConfigPatch } & Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      await api(`/api/v1/bots/${bot.id}`, { method: "PATCH", body });
      toast.push("success", okMsg ?? "Guardado. Publicá una versión para aplicarlo al bot en uso.");
      onSaved();
      return true;
    } catch (err) {
      toast.push("error", (err as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy };
}

export function SectionCard({ title, description, children, footer, className }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[10px] border border-border bg-surface", className)}>
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-[12.5px] text-fg-muted">{description}</p> : null}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer> : null}
    </section>
  );
}

export function SaveBar({ canEdit, busy, dirty = true }: { canEdit: boolean; busy: boolean; dirty?: boolean }) {
  if (!canEdit) return <p className="text-[12.5px] text-fg-muted">Solo lectura: tu rol no puede modificar bots.</p>;
  return (
    <Button type="submit" variant="secondary" loading={busy} disabled={!dirty}>
      Guardar cambios
    </Button>
  );
}

/** Interruptor accesible (role="switch"). */
export function Toggle({ checked, onChange, disabled, label, description, id: idProp }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: ReactNode; description?: ReactNode; id?: string }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "border-brand-strong bg-brand" : "border-border-strong bg-surface-muted",
        )}
      >
        <span className={cn("inline-block size-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-[2px]")} />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-[13.5px] font-medium text-fg">
          {label}
        </label>
        {description ? <p className="text-[12.5px] text-fg-muted">{description}</p> : null}
      </div>
    </div>
  );
}

/** Lista de términos separada por comas ↔ array. */
export const toTerms = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "success" | "warning" }) {
  const tones = { neutral: "border-border bg-surface-muted text-fg-secondary", info: "border-[#b2ccff] bg-info-soft text-info", success: "border-[#abefc6] bg-success-soft text-success", warning: "border-[#fedf89] bg-warning-soft text-warning" };
  return <p className={cn("rounded-md border px-3 py-2 text-[12.5px] leading-relaxed", tones[tone])}>{children}</p>;
}
