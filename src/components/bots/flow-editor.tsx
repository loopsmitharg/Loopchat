"use client";
import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Clock, Flag, GitBranch, Hand, LayoutList, MessageSquare, Network, Play, Plus, Rocket, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { NODE_LABELS, NODE_OUTPUTS, defaultNodeData, type FlowEdge, type FlowGraph, type FlowNode, type FlowNodeType } from "@/lib/flow/types";
import { validateGraph, type ValidationIssue } from "@/lib/flow/validate";
import { NodeProperties, nodeSummary } from "./node-properties";

const ICONS: Record<FlowNodeType, typeof Bot> = { start: Play, message: MessageSquare, ai: Bot, condition: GitBranch, opportunity: TrendingUp, handoff: Hand, wait: Clock, end: Flag };
const ADDABLE: FlowNodeType[] = ["message", "ai", "condition", "opportunity", "wait", "handoff", "end"];

type RFData = { node: FlowNode; issues: number; selected: boolean };

const FlowNodeView = memo(function FlowNodeView({ data }: NodeProps<Node<RFData>>) {
  const { node, issues } = data;
  const Icon = ICONS[node.type];
  const outs = NODE_OUTPUTS[node.type];
  return (
    <div className={cn("w-[220px] rounded-[9px] border bg-surface text-[12.5px] shadow-[0_1px_2px_rgb(15_23_42/0.06)]", issues ? "border-danger" : data.selected ? "border-brand-strong ring-2 ring-brand/50" : "border-border-strong")}>
      {node.type !== "start" ? <Handle type="target" position={Position.Top} className="!size-2.5 !border-2 !border-surface !bg-fg-muted" /> : null}
      <div className={cn("flex items-center gap-1.5 rounded-t-[8px] border-b px-2.5 py-1.5 font-semibold", node.type === "start" ? "border-[#d9f99d] bg-brand-soft" : node.type === "handoff" ? "border-[#fedf89] bg-warning-soft" : node.type === "ai" ? "border-[#c9ecd9] bg-[#effaf4]" : "border-border bg-surface-muted")}>
        <Icon className="size-3.5" aria-hidden />
        {NODE_LABELS[node.type]}
        {issues ? (
          <span className="ml-auto inline-flex items-center gap-0.5 text-danger">
            <AlertCircle className="size-3.5" aria-hidden />
            {issues}
          </span>
        ) : null}
      </div>
      <div className="px-2.5 py-2 text-fg-secondary">{nodeSummary(node) || <span className="text-fg-muted">—</span>}</div>
      {outs.length ? (
        <div className="relative flex justify-around border-t border-border px-1 pb-2 pt-1 text-[10.5px] text-fg-muted">
          {outs.map((h, i) => (
            <div key={h.id} className="relative flex flex-col items-center">
              <span>{h.label}</span>
              <Handle type="source" id={h.id} position={Position.Bottom} style={{ left: "50%", transform: `translate(-50%, 0)` }} className={cn("!relative !size-2.5 !border-2 !border-surface", h.id === "handoff" || h.id === "false" || h.id === "timeout" ? "!bg-[#d97706]" : "!bg-brand-strong")} data-index={i} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const nodeTypes = { flow: FlowNodeView };

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function FlowEditor({ botId, initialGraph, initialRevision, stages, canEdit, canPublish, onPublished, graphRef }: { botId: string; initialGraph: FlowGraph; initialRevision: number; stages: { id: string; name: string }[]; canEdit: boolean; canPublish: boolean; onPublished: () => void; graphRef?: React.MutableRefObject<() => unknown> }) {
  const toast = useToast();
  const [graph, setGraph] = useState<FlowGraph>(initialGraph);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"canvas" | "list">(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "list" : "canvas"));
  const [save, setSave] = useState<{ state: "saved" | "dirty" | "saving" | "error" | "conflict"; message?: string }>({ state: "saved" });
  const [publishing, setPublishing] = useState(false);
  const revision = useRef(initialRevision);
  const dirty = useRef(false);

  useEffect(() => {
    if (graphRef) graphRef.current = () => graph;
  }, [graph, graphRef]);

  const stageIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages]);
  const issues = useMemo(() => validateGraph(graph, { stageIds }), [graph, stageIds]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) if (i.nodeId) m.set(i.nodeId, (m.get(i.nodeId) ?? 0) + 1);
    return m;
  }, [issues]);

  const update = useCallback((fn: (g: FlowGraph) => FlowGraph) => {
    setGraph((g) => fn(g));
    dirty.current = true;
    setSave({ state: "dirty" });
  }, []);

  // autoguardado con control de revisión
  useEffect(() => {
    if (!dirty.current || !canEdit) return;
    const t = setTimeout(async () => {
      setSave({ state: "saving" });
      try {
        const res = await api<{ revision: number }>(`/api/v1/bots/${botId}/draft`, { method: "PUT", body: { graph, revision: revision.current } });
        revision.current = res.revision;
        dirty.current = false;
        setSave({ state: "saved" });
      } catch (e) {
        const err = e as ApiError;
        setSave({ state: err.status === 409 ? "conflict" : "error", message: err.message });
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [graph, botId, canEdit]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const rfNodes: Node<RFData>[] = useMemo(
    () => graph.nodes.map((n) => ({ id: n.id, type: "flow", position: n.position, data: { node: n, issues: issuesByNode.get(n.id) ?? 0, selected: n.id === selected }, deletable: canEdit && n.type !== "start" })),
    [graph.nodes, issuesByNode, selected, canEdit],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const label = NODE_OUTPUTS[graph.nodes.find((n) => n.id === e.source)?.type ?? "start"]?.find((h) => h.id === (e.sourceHandle || "out"));
        const warn = ["handoff", "false", "timeout"].includes(e.sourceHandle || "out");
        return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || "out", label: label && label.id !== "out" ? label.label : undefined, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: warn ? "#d97706" : "#4d7c0f", strokeWidth: 1.6 }, labelStyle: { fontSize: 11 }, deletable: canEdit };
      }),
    [graph, canEdit],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<RFData>>[]) => {
      const relevant = changes.filter((c) => c.type === "position" || c.type === "remove");
      if (!relevant.length || !canEdit) return;
      update((g) => {
        const next = applyNodeChanges(relevant, g.nodes.map((n) => ({ id: n.id, position: n.position, data: {} }) as Node));
        const ids = new Set(next.map((n) => n.id));
        return {
          nodes: g.nodes.filter((n) => ids.has(n.id) || n.type === "start").map((n) => ({ ...n, position: next.find((x) => x.id === n.id)?.position ?? n.position })),
          edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
        };
      });
    },
    [canEdit, update],
  );

  function connect(source: string, handle: string, target: string | null) {
    update((g) => {
      const edges = g.edges.filter((e) => !(e.source === source && (e.sourceHandle || "out") === handle));
      if (target) edges.push({ id: uid("e"), source, target, sourceHandle: handle });
      return { ...g, edges };
    });
  }

  const onConnect = useCallback(
    (c: Connection) => {
      if (!canEdit || !c.source || !c.target) return;
      const src = graph.nodes.find((n) => n.id === c.source);
      const tgt = graph.nodes.find((n) => n.id === c.target);
      if (!src || !tgt) return;
      if (tgt.type === "start") return toast.push("error", "No se puede conectar hacia el Inicio.");
      if (c.source === c.target) return toast.push("error", "Un nodo no puede conectarse consigo mismo.");
      connect(c.source, c.sourceHandle || "out", c.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect usa update estable
    [canEdit, graph.nodes, toast],
  );

  function addNode(type: FlowNodeType) {
    const sel = graph.nodes.find((n) => n.id === selected);
    const base = sel ?? graph.nodes[graph.nodes.length - 1];
    const id = uid(type);
    const position = { x: (base?.position.x ?? 0) + 30, y: (base?.position.y ?? 0) + 160 };
    update((g) => {
      const node = { id, type, position, data: defaultNodeData(type) } as FlowNode;
      const edges = [...g.edges];
      // conecta automáticamente desde el nodo seleccionado: usa una salida libre o, si todas
      // están ocupadas, inserta el nodo nuevo en el medio (sel → nuevo → destino anterior)
      if (sel) {
        const free = NODE_OUTPUTS[sel.type].find((h) => !edges.some((e) => e.source === sel.id && (e.sourceHandle || "out") === h.id));
        if (free) edges.push({ id: uid("e"), source: sel.id, target: id, sourceHandle: free.id });
        else {
          const first = NODE_OUTPUTS[sel.type][0];
          const idx = first ? edges.findIndex((e) => e.source === sel.id && (e.sourceHandle || "out") === first.id) : -1;
          const newOut = NODE_OUTPUTS[type][0];
          if (idx >= 0) {
            const oldTarget = edges[idx].target;
            edges[idx] = { ...edges[idx], target: id };
            if (newOut) edges.push({ id: uid("e"), source: id, target: oldTarget, sourceHandle: newOut.id });
          }
        }
      }
      return { nodes: [...g.nodes, node], edges };
    });
    setSelected(id);
  }

  function removeNode(id: string) {
    update((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.source !== id && e.target !== id) }));
    setSelected(null);
  }

  async function publish() {
    setPublishing(true);
    try {
      if (dirty.current) {
        const res = await api<{ revision: number }>(`/api/v1/bots/${botId}/draft`, { method: "PUT", body: { graph, revision: revision.current } });
        revision.current = res.revision;
        dirty.current = false;
        setSave({ state: "saved" });
      }
      const r = await api<{ version: number }>(`/api/v1/bots/${botId}/publish`, { body: {} });
      toast.push("success", `Versión ${r.version} publicada. Los mensajes nuevos usan esta versión.`);
      onPublished();
    } catch (e) {
      const err = e as ApiError;
      const list = (err.details?.issues as ValidationIssue[] | undefined)?.map((i) => i.message).join(" · ");
      toast.push("error", list ? `${err.message} ${list}` : err.message);
    } finally {
      setPublishing(false);
    }
  }

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;

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
            <span className="text-fg-muted">Agregar</span>
            <Select
              aria-label="Agregar nodo"
              value=""
              onChange={(e) => {
                if (e.target.value) addNode(e.target.value as FlowNodeType);
              }}
              className="h-8 w-44"
            >
              <option value="">Elegí un tipo…</option>
              {ADDABLE.map((t) => (
                <option key={t} value={t}>
                  {NODE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <span className={cn("text-[12px]", save.state === "error" || save.state === "conflict" ? "text-danger" : "text-fg-muted")} role="status" aria-live="polite">
          {save.state === "saved" ? "Borrador guardado" : save.state === "saving" ? "Guardando…" : save.state === "dirty" ? "Cambios sin guardar" : save.message}
        </span>
        {save.state === "conflict" ? (
          <Button size="sm" onClick={() => window.location.reload()}>
            Recargar
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {issues.length ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-danger">
              <AlertCircle className="size-4" aria-hidden /> {issues.length} {issues.length === 1 ? "problema" : "problemas"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Flujo válido
            </span>
          )}
          {canPublish ? (
            <Button variant="primary" onClick={publish} loading={publishing} disabled={issues.length > 0 || save.state === "conflict"}>
              <Rocket className="size-4" aria-hidden /> Publicar versión
            </Button>
          ) : null}
        </span>
      </div>

      {issues.length ? (
        <ul className="rounded-md border border-[#fecdca] bg-danger-soft px-3 py-2 text-[12.5px] text-danger" aria-label="Problemas del flujo">
          {issues.slice(0, 8).map((i, idx) => (
            <li key={idx}>
              {i.nodeId ? (
                <button type="button" className="underline underline-offset-2" onClick={() => setSelected(i.nodeId!)}>
                  {NODE_LABELS[graph.nodes.find((n) => n.id === i.nodeId)?.type ?? "start"]}
                </button>
              ) : null}
              {i.nodeId ? ": " : ""}
              {i.message}
            </li>
          ))}
          {issues.length > 8 ? <li>… y {issues.length - 8} más</li> : null}
        </ul>
      ) : null}

      <div className="grid min-h-[560px] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {view === "canvas" ? (
          <div className="h-[560px] overflow-hidden rounded-[10px] border border-border bg-surface lg:h-auto" aria-label="Lienzo del flujo">
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
              onNodeClick={(_, n) => setSelected(n.id)}
              onPaneClick={() => setSelected(null)}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
              fitView
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={20} size={1} color="#dde3d9" />
              <Controls showInteractive={false} />
              {graph.nodes.length > 8 ? <MiniMap pannable zoomable /> : null}
            </ReactFlow>
          </div>
        ) : (
          <FlowOutline graph={graph} selected={selected} onSelect={setSelected} canEdit={canEdit} onConnect={connect} issuesByNode={issuesByNode} />
        )}
        <aside className="min-w-0 rounded-[10px] border border-border bg-surface p-4" aria-label="Propiedades del nodo">
          {selectedNode ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold">{NODE_LABELS[selectedNode.type]}</h3>
                {canEdit && selectedNode.type !== "start" ? (
                  <Button size="sm" variant="danger" onClick={() => removeNode(selectedNode.id)}>
                    <Trash2 className="size-3.5" aria-hidden /> Eliminar
                  </Button>
                ) : null}
              </div>
              <NodeProperties
                node={selectedNode}
                stages={stages}
                disabled={!canEdit}
                onChange={(data) => update((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === selectedNode.id ? ({ ...n, data } as FlowNode) : n)) }))}
              />
              {NODE_OUTPUTS[selectedNode.type].length ? (
                <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
                  <legend className="text-[13px] font-medium text-fg-secondary">Conexiones</legend>
                  {NODE_OUTPUTS[selectedNode.type].map((h) => (
                    <OutputSelect key={h.id} graph={graph} node={selectedNode} handle={h} disabled={!canEdit} onConnect={connect} />
                  ))}
                </fieldset>
              ) : null}
              {issuesByNode.get(selectedNode.id) ? (
                <ul className="text-[12.5px] text-danger">
                  {issues
                    .filter((i) => i.nodeId === selectedNode.id)
                    .map((i, k) => (
                      <li key={k}>· {i.message}</li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="text-[13px] text-fg-muted">
              <p className="font-medium text-fg">Elegí un nodo para editarlo.</p>
              <p className="mt-1">Conectá las salidas arrastrando desde los puntos inferiores, o usá los selectores de conexión. Con el nodo seleccionado, “Agregar” crea el siguiente paso ya conectado.</p>
              {canEdit ? (
                <Button size="sm" className="mt-3" onClick={() => addNode("message")}>
                  <Plus className="size-3.5" aria-hidden /> Agregar mensaje
                </Button>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function OutputSelect({ graph, node, handle, disabled, onConnect }: { graph: FlowGraph; node: FlowNode; handle: { id: string; label: string; optional?: boolean }; disabled: boolean; onConnect: (s: string, h: string, t: string | null) => void }) {
  const current = graph.edges.find((e: FlowEdge) => e.source === node.id && (e.sourceHandle || "out") === handle.id)?.target ?? "";
  return (
    <label className="flex min-w-0 items-center gap-2 text-[12.5px]">
      <span className="w-24 shrink-0 text-fg-secondary sm:w-28">
        {handle.label}
        {handle.optional ? " (opc.)" : ""}
      </span>
      <Select value={current} disabled={disabled} onChange={(e) => onConnect(node.id, handle.id, e.target.value || null)} className="h-8 min-w-0 flex-1" aria-label={`Destino de la salida ${handle.label}`}>
        <option value="">Sin conectar</option>
        {graph.nodes
          .filter((n) => n.id !== node.id && n.type !== "start")
          .map((n) => (
            <option key={n.id} value={n.id}>
              {NODE_LABELS[n.type]} — {nodeSummary(n).slice(0, 40)}
            </option>
          ))}
      </Select>
    </label>
  );
}

/** Alternativa sin arrastre (teclado / móvil): lista de pasos y conexiones por selector. */
function FlowOutline({ graph, selected, onSelect, canEdit, onConnect, issuesByNode }: { graph: FlowGraph; selected: string | null; onSelect: (id: string) => void; canEdit: boolean; onConnect: (s: string, h: string, t: string | null) => void; issuesByNode: Map<string, number> }) {
  return (
    <ol className="flex min-w-0 flex-col gap-2" aria-label="Pasos del flujo">
      {graph.nodes.map((n, i) => {
        const Icon = ICONS[n.type];
        return (
          <li key={n.id} className={cn("min-w-0 rounded-[10px] border bg-surface p-3", issuesByNode.get(n.id) ? "border-danger" : n.id === selected ? "border-brand-strong" : "border-border")}>
            <button type="button" onClick={() => onSelect(n.id)} className="flex w-full min-w-0 items-center gap-2 text-left text-[13px]">
              <span className="text-[11.5px] text-fg-muted tabular">{i + 1}.</span>
              <Icon className="size-4" aria-hidden />
              <span className="font-semibold">{NODE_LABELS[n.type]}</span>
              <span className="min-w-0 truncate text-fg-secondary">{nodeSummary(n)}</span>
              {issuesByNode.get(n.id) ? <AlertCircle className="ml-auto size-4 text-danger" aria-label="Tiene problemas" /> : null}
            </button>
            {NODE_OUTPUTS[n.type].length ? (
              <div className="mt-2 flex min-w-0 flex-col gap-1.5 sm:pl-6">
                {NODE_OUTPUTS[n.type].map((h) => (
                  <OutputSelect key={h.id} graph={graph} node={n} handle={h} disabled={!canEdit} onConnect={onConnect} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
