"use client";
import { AlertCircle, Bot, Hand, PauseCircle, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { ConvList, ConvListItem } from "./types";

export type ListFilters = { assignee: "mine" | "unassigned" | "all"; status: "open" | "pending" | "resolved" | "all"; mode: "all" | "bot" | "requested" | "human" | "paused"; q: string };

function ModeIcon({ mode }: { mode: ConvListItem["attentionMode"] }) {
  if (mode === "bot") return <Bot className="size-3.5 text-secondary-strong" aria-label="Atiende el bot" />;
  if (mode === "paused") return <PauseCircle className="size-3.5 text-warning" aria-label="Bot pausado" />;
  if (mode === "requested") return <Hand className="size-3.5 text-warning" aria-label="Pide humano" />;
  return <Hand className="size-3.5 text-fg-muted" aria-label="Atención humana" />;
}

export function ConversationList({
  data,
  loading,
  error,
  filters,
  onFilters,
  selectedId,
  onSelect,
  onLoadMore,
  loadingMore,
  onRetry,
}: {
  data: ConvList | null;
  loading: boolean;
  error: string | null;
  filters: ListFilters;
  onFilters: (f: ListFilters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onRetry: () => void;
}) {
  const tabs: { id: ListFilters["assignee"]; label: string; count?: number }[] = [
    { id: "mine", label: "Mías", count: data?.counts.mine },
    { id: "unassigned", label: "Sin asignar", count: data?.counts.unassigned },
    { id: "all", label: "Todas" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 pt-3 pb-2">
        <div role="tablist" aria-label="Filtrar por responsable" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={filters.assignee === t.id}
              onClick={() => onFilters({ ...filters, assignee: t.id })}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                filters.assignee === t.id ? "bg-ink text-white" : "text-fg-secondary hover:bg-surface-muted",
              )}
            >
              {t.label}
              {t.count !== undefined ? <span className={cn("tabular text-[11.5px]", filters.assignee === t.id ? "text-white/70" : "text-fg-muted")}>{t.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="relative min-w-full flex-1">
            <span className="sr-only">Buscar conversaciones</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => onFilters({ ...filters, q: e.target.value })}
              placeholder="Nombre, teléfono o texto"
              className="h-8 w-full rounded-md border border-border-strong bg-surface pl-8 pr-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand/45"
            />
          </label>
          <label className="flex-1">
            <span className="sr-only">Estado</span>
            <select
              value={filters.status}
              onChange={(e) => onFilters({ ...filters, status: e.target.value as ListFilters["status"] })}
              className="h-8 w-full rounded-md border border-border-strong bg-surface px-1.5 text-[13px]"
            >
              <option value="open">Abiertas</option>
              <option value="pending">Pendientes</option>
              <option value="resolved">Resueltas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label className="flex-1">
            <span className="sr-only">Modo de atención</span>
            <select
              value={filters.mode}
              onChange={(e) => onFilters({ ...filters, mode: e.target.value as ListFilters["mode"] })}
              className="h-8 w-full rounded-md border border-border-strong bg-surface px-1.5 text-[13px]"
            >
              <option value="all">Bot y humano</option>
              <option value="bot">Bot</option>
              <option value="requested">Pide humano</option>
              <option value="human">Humano</option>
              <option value="paused">Pausado</option>
            </select>
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {loading && !data ? <SkeletonRows /> : null}
        {error && !data ? <ErrorState description={error} onRetry={onRetry} /> : null}
        {data && data.items.length === 0 ? (
          <EmptyState title="No hay conversaciones con estos filtros" description="Cuando un cliente escriba a tu número de WhatsApp, la conversación aparece acá." />
        ) : null}
        <ul aria-label="Conversaciones">
          {data?.items.map((c) => {
            const selected = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors",
                    selected ? "bg-brand-soft/60" : "hover:bg-surface-muted",
                  )}
                >
                  <Avatar name={c.contactName} seed={c.contactId} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("truncate text-[13.5px]", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{c.contactName}</span>
                      <ModeIcon mode={c.attentionMode} />
                      <span className="ml-auto shrink-0 text-[11.5px] text-fg-muted tabular">{formatRelative(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className={cn("truncate text-[12.5px]", c.unreadCount > 0 ? "text-fg" : "text-fg-muted")}>
                        {c.lastMessageDirection === "out" ? <span className="text-fg-muted">Enviado: </span> : null}
                        {c.lastMessagePreview || "(sin texto)"}
                      </span>
                      {c.lastFailed ? <AlertCircle className="size-3.5 shrink-0 text-danger" aria-label="Hay un mensaje que falló" /> : null}
                      {c.unreadCount > 0 ? (
                        <span className="ml-auto shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-fg tabular" aria-label={`${c.unreadCount} sin leer`}>
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-fg-muted">
                      {c.assigneeName ? `Resp.: ${c.assigneeName}` : "Sin responsable"}
                      {c.contactPhone ? ` · ${formatPhone(c.contactPhone)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {data?.hasMore ? (
          <div className="p-3">
            <button type="button" onClick={onLoadMore} disabled={loadingMore} className="w-full rounded-md border border-border py-2 text-[13px] text-fg-secondary hover:bg-surface-muted">
              {loadingMore ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
