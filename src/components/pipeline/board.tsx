"use client";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, GripVertical, ListChecks, Plus, Search } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";
import { OpportunityDrawer } from "./opportunity-drawer";

type Opp = { id: string; title: string; stageId: string; status: string; amount: string | null; currency: string; followUpAt: string | null; version: number; contactId: string; contactName: string; ownerUserId: string | null; ownerName: string | null; conversationId: string | null; openTasks: number; source: string };
type Board = { pipeline: { id: string; name: string }; stages: { id: string; name: string; kind: string; position: number }[]; opportunities: Opp[] };

function totals(opps: Opp[]) {
  const t: Record<string, number> = {};
  for (const o of opps) if (o.amount) t[o.currency] = (t[o.currency] ?? 0) + Number(o.amount);
  return Object.entries(t);
}

function Card({ o, stages, canWrite, onMove, onOpen, now }: { o: Opp; stages: Board["stages"]; canWrite: boolean; onMove: (o: Opp, stageId: string) => void; onOpen: (id: string) => void; now: number }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.id, disabled: !canWrite, data: { opp: o } });
  const overdue = o.followUpAt && new Date(o.followUpAt).getTime() < now && o.status === "open";
  return (
    <article
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-[8px] border border-border bg-surface p-2.5 text-[13px]", isDragging && "z-10 shadow-lg ring-2 ring-brand")}
    >
      <div className="flex items-start gap-1.5">
        {canWrite ? (
          <button type="button" {...listeners} {...attributes} aria-label={`Arrastrar ${o.title}`} className="mt-0.5 cursor-grab touch-none rounded text-fg-muted hover:text-fg">
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <button type="button" onClick={() => onOpen(o.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium hover:underline">{o.title}</span>
          <span className="block truncate text-[12px] text-fg-muted">{o.contactName}</span>
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        {o.amount ? <span className="font-medium tabular">{formatMoney(o.amount, o.currency)}</span> : <span className="text-fg-muted">Sin importe</span>}
        {o.followUpAt ? (
          <span className={cn("inline-flex items-center gap-0.5", overdue ? "text-danger" : "text-fg-muted")}>
            <CalendarClock className="size-3" aria-hidden />
            {formatDate(o.followUpAt)}
            {overdue ? <span className="sr-only"> (vencido)</span> : null}
          </span>
        ) : null}
        {o.openTasks ? (
          <span className="inline-flex items-center gap-0.5 text-fg-muted">
            <ListChecks className="size-3" aria-hidden />
            {o.openTasks}
          </span>
        ) : null}
        <span className="ml-auto">{o.ownerName ? <Avatar name={o.ownerName} seed={o.ownerUserId ?? undefined} size={20} /> : null}</span>
      </div>
      {canWrite ? (
        <label className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          Mover a
          <select value={o.stageId} onChange={(e) => onMove(o, e.target.value)} className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-1 text-[12px] text-fg" aria-label={`Mover ${o.title} a otra etapa`}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

function Column({ stage, children, count, sums }: { stage: Board["stages"][number]; children: React.ReactNode; count: number; sums: [string, number][] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} aria-label={`Etapa ${stage.name}`} className={cn("flex w-[272px] shrink-0 snap-start flex-col rounded-[10px] border border-border bg-surface-muted", isOver && "border-brand-strong bg-brand-soft/40")}>
      <header className="flex items-baseline justify-between gap-2 px-3 pt-2.5 pb-2">
        <h2 className="truncate text-[13px] font-semibold">
          {stage.name}
          {stage.kind !== "open" ? <span className="ml-1 text-[11px] font-normal text-fg-muted">({stage.kind === "won" ? "ganada" : "perdida"})</span> : null}
        </h2>
        <span className="text-[12px] text-fg-muted tabular">{count}</span>
      </header>
      <p className="px-3 pb-2 text-[11.5px] text-fg-muted tabular">{sums.length ? sums.map(([c, v]) => formatMoney(v, c)).join(" · ") : "—"}</p>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

export function PipelineBoard({ pipelines }: { pipelines: { id: string; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const canWrite = useCan("opportunity:write");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const board = useApi<Board>(`/api/v1/board?${new URLSearchParams({ pipelineId, q: debouncedQ })}`, { pollMs: 15000 });
  const members = useApi<{ members: { userId: string; name: string; status: string }[] }>("/api/v1/members");
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const openId = params.get("op");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const byStage = useMemo(() => {
    const m = new Map<string, Opp[]>();
    for (const s of board.data?.stages ?? []) m.set(s.id, []);
    for (const o of board.data?.opportunities ?? []) m.get(o.stageId)?.push(o);
    return m;
  }, [board.data]);

  async function move(o: Opp, stageId: string) {
    if (o.stageId === stageId || !board.data) return;
    const prev = board.data;
    board.setData({ ...prev, opportunities: prev.opportunities.map((x) => (x.id === o.id ? { ...x, stageId } : x)) });
    try {
      await api(`/api/v1/opportunities/${o.id}`, { method: "PATCH", body: { expectedVersion: o.version, stageId } });
      const s = prev.stages.find((x) => x.id === stageId);
      toast.push("success", `"${o.title}" movida a ${s?.name}.`);
    } catch (e) {
      board.setData(prev);
      toast.push("error", (e as ApiError).message);
    } finally {
      void board.reload();
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const o = e.active.data.current?.opp as Opp | undefined;
    if (o && e.over) void move(o, String(e.over.id));
  }

  const setOpen = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("op", id);
    else sp.delete("op");
    router.replace(`/pipeline${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col p-4 sm:p-6">
      <PageHeader
        title="Pipeline"
        description={board.data ? `${board.data.opportunities.length} oportunidades en ${board.data.pipeline.name}` : "Oportunidades por etapa"}
        actions={
          <>
            {pipelines.length > 1 ? (
              <label className="flex items-center gap-1 text-[13px]">
                <span className="sr-only">Pipeline</span>
                <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="h-9 w-48">
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="relative">
              <span className="sr-only">Buscar oportunidades</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="w-44 pl-8" type="search" />
            </label>
            {canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden /> Nueva oportunidad
              </Button>
            ) : null}
          </>
        }
      />
      {board.loading ? <SkeletonRows /> : null}
      {board.error && !board.data ? <ErrorState description={board.error.message} onRetry={() => void board.reload()} /> : null}
      {board.data ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="-mx-4 flex min-h-0 flex-1 snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6" tabIndex={0} aria-label="Tablero de oportunidades (desplazable)">
            {board.data.stages.map((s) => {
              const list = byStage.get(s.id) ?? [];
              return (
                <Column key={s.id} stage={s} count={list.length} sums={totals(list)}>
                  {list.length === 0 ? <p className="px-1 py-3 text-center text-[12px] text-fg-muted">Sin oportunidades</p> : null}
                  {list.map((o) => (
                    <Card key={o.id} o={o} stages={board.data!.stages} canWrite={canWrite} onMove={(x, sid) => void move(x, sid)} onOpen={setOpen} now={now} />
                  ))}
                </Column>
              );
            })}
          </div>
        </DndContext>
      ) : null}
      {openId ? <OpportunityDrawer id={openId} members={(members.data?.members ?? []).filter((m) => m.status === "active")} onClose={() => setOpen(null)} onChanged={() => void board.reload()} /> : null}
      <NewOpportunityModal open={creating} onClose={() => setCreating(false)} pipelineId={pipelineId} onCreated={() => void board.reload()} />
    </div>
  );
}

function NewOpportunityModal({ open, onClose, pipelineId, onCreated }: { open: boolean; onClose: () => void; pipelineId: string; onCreated: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const contacts = useApi<{ items: { id: string; name: string; phoneE164: string | null }[] }>(open ? `/api/v1/contacts?q=${encodeURIComponent(q)}` : null);
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Nueva oportunidad" description="Asociala a un contacto existente.">
      <form
        id="new-opp"
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api("/api/v1/opportunities", { body: { contactId, pipelineId, title: fd.get("title"), amount: fd.get("amount") ? Number(fd.get("amount")) : undefined } });
            toast.push("success", "Oportunidad creada.");
            onCreated();
            onClose();
          } catch (err) {
            toast.push("error", (err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Buscar contacto">{(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o teléfono" />}</Field>
        <Field label="Contacto">
          {(p) => (
            <Select {...p} value={contactId} onChange={(e) => setContactId(e.target.value)} required>
              <option value="">Elegí un contacto</option>
              {contacts.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phoneE164 ? `(${c.phoneE164})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Título">{(p) => <Input {...p} name="title" required minLength={2} placeholder="Ej.: Compra de 20 bolsas de cemento" />}</Field>
        <Field label="Importe estimado (opcional)">{(p) => <Input {...p} name="amount" inputMode="decimal" />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!contactId}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}
