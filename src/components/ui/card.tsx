import type { ReactNode } from "react";
import { cn } from "./cn";

export function Panel({ title, actions, children, className, bodyClassName, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; description?: ReactNode }) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[14px] font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="text-[12.5px] text-fg-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="text-[13px] text-fg-muted mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
