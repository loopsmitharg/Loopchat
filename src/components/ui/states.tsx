import type { ReactNode } from "react";
import { AlertTriangle, Lock, WifiOff } from "lucide-react";
import { cn } from "./cn";

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-2 px-6 py-10", className)}>
      {icon ? <div className="text-fg-muted mb-1">{icon}</div> : null}
      <p className="font-medium text-fg">{title}</p>
      {description ? <p className="text-[13px] text-fg-muted max-w-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "No pudimos cargar esta información", description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <AlertTriangle className="size-5 text-danger" aria-hidden />
      <p className="font-medium">{title}</p>
      {description ? <p className="text-[13px] text-fg-muted max-w-sm">{description}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-1 text-[13px] font-medium text-brand-strong underline underline-offset-2">
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export function ForbiddenState({ description = "Tu rol no tiene acceso a esta sección. Pedile acceso a un administrador de tu empresa." }: { description?: string }) {
  return <EmptyState icon={<Lock className="size-5" />} title="Sin permiso" description={description} />;
}

export function OfflineBanner() {
  return (
    <div role="status" className="flex items-center gap-2 bg-warning-soft text-warning text-[13px] px-4 py-2 border-b border-[#fedf89]">
      <WifiOff className="size-4" aria-hidden /> Sin conexión. Los cambios se reintentarán al volver la red.
    </div>
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 p-4", className)} role="status" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton size-8 rounded-full" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
