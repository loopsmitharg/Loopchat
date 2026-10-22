"use client";
import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, CircleSlash, DoorOpen, ExternalLink, Hand, KanbanSquare, LayoutList, Network, Plus, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_TEMPLATES, type RoleKey } from "@/lib/team/roles";
import { describeCondition, type RouteCondition, type TeamEdge, type TeamGraph, type TeamNode } from "@/lib/team/types";
import type { TeamIssue } from "@/lib/team/validate";
import { ConditionForm } from "./edge-form";

export type TeamBotOpt = { id: string; name: string; role: RoleKey; status: string; publishedVersion: number | null; pipelineId: string | null };
export type PipelineOpt = { id: string; name: string; isDefault: boolean };
export type TeamEditorApi = { update: (fn: (g: TeamGraph) => TeamGraph) => void; flush: () => Promise<void> };

type RFData = { node: TeamNode; bot?: TeamBotOpt; entry: boolean; pipeline: string | null; links: number; issues: number; selected: boolean };

const TeamNodeView = memo(function TeamNodeView({ data }: NodeProps<Node<RFData>>) {
  const { node, bot } = data;
  if (node.type === "human")
    return (
      <div className={cn("w-[200px] rounded-[9px] border bg-warning-soft text-[12.5px] shadow-[0_1px_2px_rgb(15_23_42/0.06)]", data.selected ? "border-brand-strong ring-2 ring-brand/50" : "border-[#fedf89]")}>
        <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-surface !bg-fg-muted" />
        <div className="flex items-center gap-1.5 px-2.5 py-2 font-semibold text-warning">
          <Hand className="size-4" aria-hidden /> Atención humana
        </div>
        <p className="border-t border-[#fedf89] px-2.5 py-1.5 text-[11.5px] text-fg-secondary">Todo el equipo se detiene hasta que una persona lo reanude.</p>
      </div>
    );
  const role = bot ? (ROLE_TEMPLATES[bot.role]?.label ?? bot.role) : "Bot eliminado";
  const off = node.data.disabled;
  return (
    <div className={cn("w-[230px] rounded-[9px] border bg-surface text-[12.5px] shadow-[0_1px_2px_rgb(15_23_42/0.06)]", data.issues ? "border-danger" : data.selected ? "border-brand-strong ring-2 ring-brand/50" : "border-border-strong", off && "opacity-60")}>
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-surface !bg-fg-muted" />
      <div className={cn("flex items-center gap-1.5 rounded-t-[8px] border-b px-2.5 py-1.5", data.entry ? "border-[#d9f99d] bg-brand-soft" : "border-border bg-surface-muted")}>
        <span className="min-w-0 flex-1 truncate font-semibold">{bot?.name ?? "Bot eliminado"}</span>
        {data.issues ? (
          <span className="inline-flex items-center gap-0.5 text-danger" title="Configuración incompleta">
            <AlertCircle className="size-3.5" aria-hidden />
            {data.issues}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2 text-fg-secondary">
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-fg">{role}</span>
          {data.entry ? <span className="rounded bg-brand px-1 text-[10.5px] font-semibold text-brand-fg">Entrada</span> : null}
          {off ? <span className="rounded bg-surface-muted px-1 text-[10.5px]">Deshabilitado</span> : bot && !bot.publishedVersion ? <span className="rounded bg-warning-soft px-1 text-[10.5px] text-warning">Sin publicar</span> : <span className="rounded bg-success-soft px-1 text-[10.5px] text-success">Listo</span>}
        </span>
        <span className="flex items-center gap-1 truncate text-[11.5px]">
          <KanbanSquare className="size-3 shrink-0" aria-hidden /> {data.pipeline ?? "Pipeline principal"}
        </span>
        <span className="text-[11.5px] text-fg-muted">{data.links} conexión{data.links === 1 ? "" : "es"}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-surface !bg-brand-strong" />
    </div>
  );
});

const nodeTypes = { team: TeamNodeView };
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

export function TeamEditor({
  teamId,
  initialGraph,
  initialRevision,
  initialIssues,
  bots,
  pipelines,
  canEdit,
  onSaved,
  graphRef,
  apiRef,
}: {
  teamId: string;
  initialGraph: TeamGraph;
  initialRevision: number;
  initialIssues: TeamIssue[];
  bots: TeamBotOpt[];
  pipelines: PipelineOpt[];
  canEdit: boolean;
  onSaved: (issues: TeamIssue[]) => void;
  graphRef?: React.MutableRefObject<() => TeamGraph>;
  /** Para otras pestañas: modificar el borrador y forzar el guardado antes de publicar. */
  apiRef?: React.MutableRefObject<TeamEditorApi | null>;
}) {
  const toast = useToast();
  const [graph, setGraph] = useState<TeamGraph>(initialGraph);
  const [issues, setIssues] = useState<TeamIssue[]>(initialIssues);
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [view, setView] = useState<"canvas" | "list">(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "list" : "canvas"));
  const [save, setSave] = useState<{ state: "saved" | "dirty" | "saving" | "error" | "conflict"; message?: string }>({ state: "saved" });
  const revision = useRef(initialRevision);
  const dirty = useRef(false);

  useEffect(() => {
    if (graphRef) graphRef.current = () => graph;
  }, [graph, graphRef]);

  const saveNow = useCallback(
    async (g: TeamGraph) => {
      const res = await api<{ revision: number; issues: TeamIssue[] }>(`/api/v1/teams/${teamId}/draft`, { method: "PUT", body: { graph: g, revision: revision.current } });
      revision.current = res.revision;
      dirty.current = false;
      setIssues(res.issues);
      onSaved(res.issues);
      setSave({ state: "saved" });
    },
    [teamId, onSaved],
  );

  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const pipeName = useCallback((b?: TeamBotOpt) => (b?.pipelineId ? (pipelines.find((p) => p.id === b.pipelineId)?.name ?? "Pipeline eliminado") : null), [pipelines]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) if (i.nodeId && i.severity === "error") m.set(i.nodeId, (m.get(i.nodeId) ?? 0) + 1);
    return m;
  }, [issues]);
  const errors = issues.filter((i) => i.severity === "error");

  const update = useCallback((fn: (g: TeamGraph) => TeamGraph) => {
    setGraph((g) => fn(g));
    dirty.current = true;
    setSave({ state: "dirty" });
  }, []);

  // autoguardado del borrador con control de revisión (la validación la devuelve el servidor)
  useEffect(() => {
    if (!dirty.current || !canEdit) return;
    const t = setTimeout(async () => {
      setSave({ state: "saving" });
      try {
        await saveNow(graph);
      } catch (e) {
        const err = e as ApiError;
        setSave({ state: err.status === 409 ? "conflict" : "error", message: err.message });
      }
    }, 900);
    return () => clearTimeout(t);
  }, [graph, canEdit, saveNow]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      update,
      flush: async () => {
        if (dirty.current && canEdit) await saveNow(graph);
      },
    };
  }, [apiRef, update, saveNow, graph, canEdit]);

  const links = (id: string) => graph.edges.filter((e) => e.source === id || e.target === id).length;
  const rfNodes: Node<RFData>[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const bot = n.type === "bot" ? botById.get(n.data.botId) : undefined;
        return {
          id: n.id,
          type: "team",
          position: n.position,
          data: { node: n, bot, entry: graph.settings.entryNodeId === n.id, pipeline: pipeName(bot), links: links(n.id), issues: issuesByNode.get(n.id) ?? 0, selected: selected?.kind === "node" && selected.id === n.id },
          deletable: canEdit,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- links depende de graph
    [graph, botById, issuesByNode, selected, canEdit, pipeName],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const toHuman = graph.nodes.find((n) => n.id === e.target)?.type === "human";
        const sel = selected?.kind === "edge" && selected.id === e.id;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: describeCondition(e.data.condition),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: !e.data.enabled ? "#94a3b8" : toHuman ? "#d97706" : "#4d7c0f", strokeWidth: sel ? 2.6 : 1.6, strokeDasharray: e.data.enabled ? undefined : "5 4" },
          labelStyle: { fontSize: 11 },
          labelBgStyle: { fill: "#ffffff" },
          deletable: canEdit,
        };
      }),
    [graph, selected, canEdit],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<RFData>>[]) => {
      const relevant = changes.filter((c) => c.type === "position" || c.type === "remove");
      if (!relevant.length || !canEdit) return;
      update((g) => {
        const next = applyNodeChanges(relevant, g.nodes.map((n) => ({ id: n.id, position: n.position, data: {} }) as Node));
        const ids = new Set(next.map((n) => n.id));
        return {
          ...g,
          nodes: g.nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, position: next.find((x) => x.id === n.id)?.position ?? n.position })),
          edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
          settings: { ...g.settings, entryNodeId: g.settings.entryNodeId && ids.has(g.settings.entryNodeId) ? g.settings.entryNodeId : null },
        };
      });
    },
    [canEdit, update],
  );

  function defaultCondition(targetId: string): RouteCondition {
    const t = graph.nodes.find((n) => n.id === targetId);
    if (t?.type === "human") return { kind: "keywords", keywords: ["hablar con una persona", "asesor"] };
    const b = t?.type === "bot" ? botById.get(t.data.botId) : undefined;
    return { kind: "intent", intents: b ? [...(ROLE_TEMPLATES[b.role]?.intents ?? [])] : [] };
  }

  function addEdge(source: string, target: string) {
    const src = graph.nodes.find((n) => n.id === source);
    if (!src || src.type === "human") return toast.push("error", "La atención humana no deriva a bots.");
    if (source === target) return toast.push("error", "Un bot no puede derivarse a sí mismo.");
    if (graph.edges.some((e) => e.source === source && e.target === target)) return toast.push("error", "Ya existe esa derivación: editá su condición.");
    const id = uid("e");
    update((g) => ({ ...g, edges: [...g.edges, { id, source, target, data: { condition: defaultCondition(target), enabled: true } }] }));
    setSelected({ kind: "edge", id });
  }

  const onConnect = useCallback(
    (c: Connection) => {
      if (canEdit && c.source && c.target) addEdge(c.source, c.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addEdge usa el grafo actual
    [canEdit, graph],
  );

  function addBot(botId: string) {
    const id = uid("n");
    const count = graph.nodes.filter((n) => n.type === "bot").length;
    update((g) => ({
      ...g,
      nodes: [...g.nodes, { id, type: "bot", position: { x: 80 + (count % 3) * 280, y: 60 + Math.floor(count / 3) * 200 }, data: { botId } }],
      settings: { ...g.settings, entryNodeId: g.settings.entryNodeId ?? id },
    }));
    setSelected({ kind: "node", id });
  }
  function addHuman() {
    update((g) => ({ ...g, nodes: [...g.nodes, { id: "human", type: "human", position: { x: 700, y: 200 }, data: {} }] }));
  }
  function removeNode(id: string) {
    update((g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.source !== id && e.target !== id), settings: { ...g.settings, entryNodeId: g.settings.entryNodeId === id ? null : g.settings.entryNodeId } }));
    setSelected(null);
  }
  const setEdge = (id: string, patch: Partial<TeamEdge["data"]>) => update((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)) }));

  const free = bots.filter((b) => !graph.nodes.some((n) => n.type === "bot" && n.data.botId === b.id));
  const hasHuman = graph.nodes.some((n) => n.type === "human");
  const selNode = selected?.kind === "node" ? graph.nodes.find((n) => n.id === selected.id) : undefined;
  const selEdge = selected?.kind === "edge" ? graph.edges.find((e) => e.id === selected.id) : undefined;
  const label = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n?.type === "human" ? "Atención humana" : n?.type === "bot" ? (botById.get(n.data.botId)?.name ?? "Bot eliminado") : "?";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Vista del editor" className="flex rounded-md border border-border bg-surface p-0.5 text-[12.5px]">
          <button type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1", view === "canvas" ? "bg-ink text-white" : "text-fg-secondary")}>
            <Network className="size-3.5" aria-hidden /> Lienzo
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1", view === "list" ? "bg-ink text-white" : "text-fg-secondary")}>
            <LayoutList className="size-3.5" aria-hidden /> Lista
          </button>
        </div>
        {canEdit ? (
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <span className="whitespace-nowrap text-fg-muted">Agregar bot</span>
            <Select aria-label="Agregar bot al equipo" value="" onChange={(e) => e.target.value && addBot(e.target.value)} className="h-8 w-48">
              <option value="">{free.length ? "Elegí un bot…" : "No hay más bots"}</option>
              {free.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({ROLE_TEMPLATES[b.role]?.label ?? b.role})
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {canEdit && !hasHuman ? (
          <Button size="sm" onClick={addHuman}>
            <UserRound className="size-3.5" aria-hidden /> Agregar atención humana
          </Button>
        ) : null}
        <span className={cn("text-[12px]", save.state === "error" || save.state === "conflict" ? "text-danger" : "text-fg-muted")} role="status" aria-live="polite">
          {save.state === "saved" ? "Borrador guardado" : save.state === "saving" ? "Guardando…" : save.state === "dirty" ? "Cambios sin guardar" : save.message}
        </span>
        {save.state === "conflict" ? (
          <Button size="sm" onClick={() => window.location.reload()}>
            Recargar
          </Button>
        ) : null}
        <span className="ml-auto">
          {errors.length ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-danger">
              <AlertCircle className="size-4" aria-hidden /> {errors.length} {errors.length === 1 ? "problema" : "problemas"} antes de publicar
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Equipo válido
            </span>
          )}
        </span>
      </div>

      {issues.length ? (
        <ul className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]" aria-label="Revisión del equipo">
          {issues.slice(0, 10).map((i, k) => (
            <li key={k} className={i.severity === "error" ? "text-danger" : "text-warning"}>
              {i.nodeId ? (
                <button type="button" className="underline underline-offset-2" onClick={() => setSelected({ kind: "node", id: i.nodeId! })}>
                  {label(i.nodeId)}
                </button>
              ) : i.edgeId ? (
                <button type="button" className="underline underline-offset-2" onClick={() => setSelected({ kind: "edge", id: i.edgeId! })}>
                  Derivación
                </button>
              ) : null}
              {i.nodeId || i.edgeId ? ": " : ""}
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid min-h-[540px] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {view === "canvas" ? (
          <div className="h-[540px] overflow-hidden rounded-[10px] border border-border bg-surface lg:h-auto" aria-label="Lienzo del equipo">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={(changes) => {
                const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
                if (removed.length && canEdit) update((g) => ({ ...g, edges: g.edges.filter((e) => !removed.includes(e.id)) }));
              }}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelected({ kind: "node", id: n.id })}
              onEdgeClick={(_, e) => setSelected({ kind: "edge", id: e.id })}
              onPaneClick={() => setSelected(null)}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
              fitView
            >
              <Background gap={20} size={1} color="#dde3d9" />
              <Controls showInteractive={false} />
              {graph.nodes.length > 8 ? <MiniMap pannable zoomable /> : null}
            </ReactFlow>
          </div>
        ) : (
          <ol className="flex min-w-0 flex-col gap-2" aria-label="Bots del equipo">
            {graph.nodes.map((n) => {
              const b = n.type === "bot" ? botById.get(n.data.botId) : undefined;
              const outs = graph.edges.filter((e) => e.source === n.id);
              return (
                <li key={n.id} className={cn("min-w-0 rounded-[10px] border bg-surface p-3", issuesByNode.get(n.id) ? "border-danger" : selected?.id === n.id ? "border-brand-strong" : "border-border")}>
                  <button type="button" onClick={() => setSelected({ kind: "node", id: n.id })} className="flex w-full min-w-0 items-center gap-2 text-left text-[13px]">
                    {n.type === "human" ? <Hand className="size-4" aria-hidden /> : null}
                    <span className="font-semibold">{label(n.id)}</span>
                    {b ? <span className="text-fg-muted">{ROLE_TEMPLATES[b.role]?.label}</span> : null}
                    {graph.settings.entryNodeId === n.id ? <Badge tone="brand">Entrada</Badge> : null}
                    {n.type === "bot" && n.data.disabled ? <Badge>Deshabilitado</Badge> : null}
                    {issuesByNode.get(n.id) ? <AlertCircle className="ml-auto size-4 text-danger" aria-label="Tiene problemas" /> : null}
                  </button>
                  {outs.length ? (
                    <ul className="mt-2 flex flex-col gap-1 sm:pl-6">
                      {outs.map((e) => (
                        <li key={e.id}>
                          <button type="button" onClick={() => setSelected({ kind: "edge", id: e.id })} className={cn("inline-flex min-w-0 items-center gap-1 text-left text-[12.5px] underline-offset-2 hover:underline", !e.data.enabled && "text-fg-muted line-through")}>
                            <ArrowRight className="size-3.5 shrink-0" aria-hidden /> {label(e.target)} — {describeCondition(e.data.condition)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        <aside className="min-w-0 rounded-[10px] border border-border bg-surface p-4" aria-label="Detalle del elemento seleccionado">
          {selNode?.type === "bot" ? (
            <BotNodePanel
              node={selNode}
              bot={botById.get(selNode.data.botId)}
              pipeline={pipeName(botById.get(selNode.data.botId))}
              entry={graph.settings.entryNodeId === selNode.id}
              outs={graph.edges.filter((e) => e.source === selNode.id)}
              targets={graph.nodes.filter((n) => n.id !== selNode.id)}
              label={label}
              canEdit={canEdit}
              issues={issues.filter((i) => i.nodeId === selNode.id)}
              onEntry={() => update((g) => ({ ...g, settings: { ...g.settings, entryNodeId: selNode.id } }))}
              onToggle={() => update((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === selNode.id && n.type === "bot" ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n)) }))}
              onRemove={() => removeNode(selNode.id)}
              onAddEdge={(t) => addEdge(selNode.id, t)}
              onSelectEdge={(id) => setSelected({ kind: "edge", id })}
            />
          ) : selNode?.type === "human" ? (
            <div className="flex flex-col gap-3 text-[13px]">
              <h3 className="flex items-center gap-1.5 text-[14px] font-semibold">
                <Hand className="size-4" aria-hidden /> Atención humana
              </h3>
              <p className="text-fg-secondary">Cuando una derivación llega acá, la conversación pasa a “Pide humano”: <strong>todos los bots del equipo dejan de responder</strong> y nadie la retoma automáticamente. Una persona la reanuda desde Conversaciones eligiendo con qué bot.</p>
              {canEdit ? (
                <Button size="sm" variant="danger" onClick={() => removeNode(selNode.id)}>
                  <Trash2 className="size-3.5" aria-hidden /> Quitar del equipo
                </Button>
              ) : null}
            </div>
          ) : selEdge ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-[14px] font-semibold">
                {label(selEdge.source)} <ArrowRight className="inline size-3.5" aria-hidden /> {label(selEdge.target)}
              </h3>
              <ConditionForm key={selEdge.id} value={selEdge.data.condition} disabled={!canEdit} onChange={(c) => setEdge(selEdge.id, { condition: c })} />
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={selEdge.data.enabled} disabled={!canEdit} onChange={(e) => setEdge(selEdge.id, { enabled: e.target.checked })} /> Derivación activa
              </label>
              {graph.nodes.find((n) => n.id === selEdge.target)?.type === "bot" ? (
                <label className="flex flex-col gap-1 text-[13px]">
                  <span className="font-medium text-fg-secondary">Mensaje de transición (opcional)</span>
                  <input
                    className="h-9 rounded-md border border-border-strong bg-surface px-2"
                    maxLength={300}
                    value={selEdge.data.message ?? ""}
                    disabled={!canEdit}
                    placeholder="Vacío = derivación silenciosa"
                    onChange={(e) => setEdge(selEdge.id, { message: e.target.value })}
                  />
                  <span className="text-[12px] text-fg-muted">Texto fijo (sin IA) que se envía al pasar la conversación. Recomendado: dejarlo vacío.</span>
                </label>
              ) : null}
              {issues
                .filter((i) => i.edgeId === selEdge.id)
                .map((i, k) => (
                  <p key={k} className="text-[12.5px] text-danger">
                    · {i.message}
                  </p>
                ))}
              {canEdit ? (
                <Button size="sm" variant="danger" onClick={() => {
                    update((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== selEdge.id) }));
                    setSelected(null);
                  }}>
                  <Trash2 className="size-3.5" aria-hidden /> Eliminar derivación
                </Button>
              ) : null}
              <p className="text-[12px] text-fg-muted">Por defecto el cliente no recibe un aviso de “ahora te atiende otro bot”: el bot que recibe continúa la conversación con todo el contexto.</p>
            </div>
          ) : (
            <div className="text-[13px] text-fg-muted">
              <p className="font-medium text-fg">Elegí un bot o una derivación para editarla.</p>
              <p className="mt-1">Arrastrá desde el punto derecho de un bot hasta otro para crear una derivación, o usá el panel del bot. El bot marcado como <strong>Entrada</strong> recibe los mensajes nuevos.</p>
              <p className="mt-2">Las derivaciones se evalúan primero sin IA (palabras clave y necesidad detectada). La IA de tu empresa solo se usa si la recepcionista no logra identificar la necesidad.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function BotNodePanel({
  node,
  bot,
  pipeline,
  entry,
  outs,
  targets,
  label,
  canEdit,
  issues,
  onEntry,
  onToggle,
  onRemove,
  onAddEdge,
  onSelectEdge,
}: {
  node: Extract<TeamNode, { type: "bot" }>;
  bot?: TeamBotOpt;
  pipeline: string | null;
  entry: boolean;
  outs: TeamEdge[];
  targets: TeamNode[];
  label: (id: string) => string;
  canEdit: boolean;
  issues: TeamIssue[];
  onEntry: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onAddEdge: (target: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const free = targets.filter((t) => !outs.some((e) => e.target === t.id));
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div>
        <h3 className="text-[14px] font-semibold">{bot?.name ?? "Bot eliminado"}</h3>
        <p className="text-fg-muted">
          {bot ? (ROLE_TEMPLATES[bot.role]?.label ?? bot.role) : "—"} · {pipeline ?? "Pipeline principal"} · {bot?.publishedVersion ? `v${bot.publishedVersion} publicada` : "sin versión publicada"}
        </p>
        {bot ? (
          <Link href={`/chatbots/${bot.id}`} className="mt-1 inline-flex items-center gap-1 text-[12.5px] underline underline-offset-2">
            <ExternalLink className="size-3.5" aria-hidden /> Configurar este bot (instrucciones, pipeline, herramientas)
          </Link>
        ) : null}
      </div>
      {bot?.role === "receptionist" ? <p className="rounded-md border border-[#b2ccff] bg-info-soft px-2.5 py-1.5 text-[12.5px] text-info">Recepcionista: identifica la necesidad y deriva. Nunca crea ni mueve oportunidades.</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={entry ? "primary" : "outline"} disabled={entry || node.data.disabled} onClick={onEntry}>
            <DoorOpen className="size-3.5" aria-hidden /> {entry ? "Es el bot de entrada" : "Usar como entrada"}
          </Button>
          <Button size="sm" onClick={onToggle}>
            <CircleSlash className="size-3.5" aria-hidden /> {node.data.disabled ? "Habilitar" : "Deshabilitar"}
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            <Trash2 className="size-3.5" aria-hidden /> Quitar
          </Button>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-1.5 border-t border-border pt-3">
        <legend className="text-[13px] font-medium text-fg-secondary">Deriva a</legend>
        {outs.length === 0 ? <p className="text-fg-muted">Sin derivaciones: este bot atiende todo lo que recibe.</p> : null}
        {outs.map((e) => (
          <button key={e.id} type="button" onClick={() => onSelectEdge(e.id)} className={cn("flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-left hover:bg-surface-muted", !e.data.enabled && "text-fg-muted line-through")}>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            <span className="font-medium">{label(e.target)}</span>
            <span className="min-w-0 truncate text-fg-muted">— {describeCondition(e.data.condition)}</span>
          </button>
        ))}
        {canEdit && free.length ? (
          <label className="mt-1 flex items-center gap-1.5">
            <Plus className="size-3.5 text-fg-muted" aria-hidden />
            <span className="sr-only">Nueva derivación hacia</span>
            <Select aria-label="Nueva derivación hacia" value="" onChange={(e) => e.target.value && onAddEdge(e.target.value)} className="h-8 min-w-0 flex-1">
              <option value="">Nueva derivación hacia…</option>
              {free.map((t) => (
                <option key={t.id} value={t.id}>
                  {label(t.id)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </fieldset>
      {issues.length ? (
        <ul className="text-[12.5px]">
          {issues.map((i, k) => (
            <li key={k} className={i.severity === "error" ? "text-danger" : "text-warning"}>
              · {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
