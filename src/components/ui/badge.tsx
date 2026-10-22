import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-secondary border-border",
  brand: "bg-brand-soft text-[#365314] border-[#d9f99d]",
  success: "bg-success-soft text-success border-[#abefc6]",
  warning: "bg-warning-soft text-warning border-[#fedf89]",
  danger: "bg-danger-soft text-danger border-[#fecdca]",
  info: "bg-info-soft text-info border-[#b2ccff]",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
