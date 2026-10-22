"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/states";
import { api, useApi } from "@/lib/api-client";
import { ChatPanel } from "./chat-panel";
import { ContextPanel } from "./context-panel";
import { ConversationList, type ListFilters } from "./conversation-list";
import type { ConvDetail, ConvList, Member } from "./types";

type Pipeline = { id: string; stages: { id: string; name: string; kind: string }[] };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Inbox({ hasChannel }: { hasChannel: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const [filters, setFilters] = useState<ListFilters>({ assignee: "all", status: "open", mode: "all", q: "" });
  const q = useDebounced(filters.q, 300);
  const [contextOpen, setContextOpen] = useState(false);
  const [extra, setExtra] = useState<ConvList["items"]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const canWriteOpp = useCan("opportunity:write");

  const listUrl = `/api/v1/conversations?${new URLSearchParams({ assignee: filters.assignee, status: filters.status, mode: filters.mode, q })}`;
  const list = useApi<ConvList>(listUrl, { pollMs: 5000 });
  const detail = useApi<ConvDetail>(selectedId ? `/api/v1/conversations/${selectedId}` : null, { pollMs: 4000 });
  const members = useApi<{ members: Member[] }>("/api/v1/members");
  const pipelines = useApi<Pipeline[]>("/api/v1/pipelines");

  const onFilters = useCallback((f: ListFilters) => {
    setFilters(f);
    setExtra([]);
  }, []);

  const select = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("c", id);
    else sp.delete("c");
    router.replace(`/conversaciones${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  const merged = list.data ? { ...list.data, items: [...list.data.items, ...extra.filter((e) => !list.data!.items.some((i) => i.id === e.id))] } : null;
  const oppPipeline = detail.data?.opportunities[0]?.pipelineId;
  const stages = (pipelines.data?.find((p) => p.id === oppPipeline) ?? pipelines.data?.[0])?.stages ?? [];

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0">
      <div className={cn("w-full shrink-0 border-r border-border bg-surface lg:w-[340px]", selectedId ? "hidden lg:block" : "block")}>
        {!hasChannel && merged?.items.length === 0 ? (
          <EmptyState title="Todavía no conectaste WhatsApp" description="Un administrador debe conectar el número oficial de Meta en Configuración → WhatsApp." />
        ) : (
          <ConversationList
            data={merged}
            loading={list.loading}
            error={list.error?.message ?? null}
            filters={filters}
            onFilters={onFilters}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
            onRetry={() => void list.reload()}
            loadingMore={loadingMore}
            onLoadMore={async () => {
              const before = merged?.items.at(-1)?.lastMessageAt;
              if (!before) return;
              setLoadingMore(true);
              try {
                const more = await api<ConvList>(`${listUrl}&before=${encodeURIComponent(before)}`);
                setExtra((x) => [...x, ...more.items]);
              } finally {
                setLoadingMore(false);
              }
            }}
          />
        )}
      </div>
      <section className={cn("min-w-0 flex-1 flex-col bg-background", selectedId ? "flex" : "hidden lg:flex")} aria-label="Conversación">
        {selectedId ? (
          <ChatPanel
            detail={detail.data}
            loading={detail.loading}
            error={detail.error?.message ?? null}
            members={members.data?.members ?? []}
            onBack={() => select(null)}
            onToggleContext={() => setContextOpen((v) => !v)}
            onChanged={() => {
              void detail.reload();
              void list.reload();
            }}
          />
        ) : (
          <EmptyState className="m-auto" title="Elegí una conversación" description="Las conversaciones con mensajes sin leer aparecen primero." />
        )}
      </section>
      {selectedId && detail.data ? (
        <>
          <aside className={cn("hidden w-[320px] shrink-0 overflow-y-auto border-l border-border bg-surface", contextOpen ? "xl:hidden" : "xl:block")} aria-label="Ficha y oportunidades">
            <ContextPanel detail={detail.data} stages={stages} canWriteOpp={canWriteOpp} onChanged={() => void detail.reload()} />
          </aside>
          {contextOpen ? (
            <div className="fixed inset-0 z-40 flex justify-end xl:static xl:z-auto xl:block xl:w-[320px] xl:shrink-0" role="dialog" aria-label="Ficha y oportunidades">
              <button type="button" aria-label="Cerrar ficha" className="absolute inset-0 bg-ink/30 xl:hidden" onClick={() => setContextOpen(false)} />
              <div className="relative h-full w-full max-w-[360px] overflow-y-auto border-l border-border bg-surface xl:max-w-none">
                <div className="flex justify-end p-2">
                  <button type="button" onClick={() => setContextOpen(false)} className="rounded p-1 hover:bg-surface-muted" aria-label="Cerrar ficha">
                    <X className="size-4" />
                  </button>
                </div>
                <ContextPanel detail={detail.data} stages={stages} canWriteOpp={canWriteOpp} onChanged={() => void detail.reload()} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
