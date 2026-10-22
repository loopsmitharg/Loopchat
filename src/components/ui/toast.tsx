"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "./cn";

type Toast = { id: number; tone: "success" | "error" | "info"; message: string };
const Ctx = createContext<{ push: (tone: Toast["tone"], message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  const ref = useRef<HTMLDivElement>(null);
  // Se muestra como "popover" (top layer) para quedar por encima de los <dialog> modales.
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      if (items.length) {
        el.hidePopover?.();
        el.showPopover();
      } else el.hidePopover?.();
    } catch {
      /* navegador sin soporte de popover: queda como capa fija */
    }
  }, [items]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div ref={ref} popover="manual" aria-live="polite" className="fixed inset-auto bottom-4 right-4 left-4 m-0 flex flex-col gap-2 overflow-visible border-0 bg-transparent p-0 sm:left-auto sm:w-96 [&:not(:popover-open)]:flex">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 rounded-[10px] border bg-surface px-3 py-2.5 text-[13px] shadow-[0_8px_24px_rgb(15_23_42/0.12)]",
              t.tone === "error" ? "border-[#fecdca]" : "border-border",
            )}
          >
            {t.tone === "success" ? <CheckCircle2 className="size-4 text-success mt-0.5" aria-hidden /> : t.tone === "error" ? <XCircle className="size-4 text-danger mt-0.5" aria-hidden /> : <Info className="size-4 text-info mt-0.5" aria-hidden />}
            <p className="flex-1">{t.message}</p>
            <button type="button" aria-label="Cerrar aviso" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-fg-muted hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast fuera de ToastProvider");
  return c;
}
