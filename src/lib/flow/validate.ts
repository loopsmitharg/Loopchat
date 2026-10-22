import { AI_TOOLS, MAX_NODES, NODE_OUTPUTS, NODE_TYPES, type FlowEdge, type FlowGraph, type FlowNode } from "./types";

export type ValidationIssue = { nodeId?: string; edgeId?: string; message: string };

/**
 * Validación determinística del grafo (la usan el editor y el publicador del servidor).
 * Reglas: un único inicio, conexiones tipadas, salidas obligatorias, todo alcanzable,
 * sin ciclos que no pasen por "Esperar respuesta" (evita bucles sin límite).
 */
export function validateGraph(graph: unknown, opts: { stageIds?: Set<string> } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!graph || typeof graph !== "object") return [{ message: "El flujo está vacío o es inválido." }];
  const g = graph as FlowGraph;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return [{ message: "Formato de flujo inválido." }];
  if (g.nodes.length === 0) return [{ message: "Agregá al menos un nodo de Inicio." }];
  if (g.nodes.length > MAX_NODES) issues.push({ message: `El flujo supera el máximo de ${MAX_NODES} nodos.` });

  const byId = new Map<string, FlowNode>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== "string" || !n.id) {
      issues.push({ message: "Hay un nodo sin identificador." });
      continue;
    }
    if (byId.has(n.id)) issues.push({ nodeId: n.id, message: "Identificador de nodo duplicado." });
    if (!(NODE_TYPES as readonly string[]).includes(n.type)) {
      issues.push({ nodeId: n.id, message: `Tipo de nodo desconocido: ${String(n.type)}` });
      continue;
    }
    byId.set(n.id, n);
  }

  const starts = g.nodes.filter((n) => n.type === "start");
  if (starts.length === 0) issues.push({ message: "Falta el nodo de Inicio." });
  if (starts.length > 1) starts.slice(1).forEach((n) => issues.push({ nodeId: n.id, message: "Solo puede haber un nodo de Inicio." }));

  // datos de cada nodo
  for (const n of byId.values()) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    switch (n.type) {
      case "message": {
        const text = typeof d.text === "string" ? d.text.trim() : "";
        if (!text) issues.push({ nodeId: n.id, message: "El mensaje está vacío." });
        if (text.length > 4000) issues.push({ nodeId: n.id, message: "El mensaje supera 4000 caracteres." });
        break;
      }
      case "ai": {
        const tools = Array.isArray(d.tools) ? d.tools : [];
        const bad = tools.filter((t) => !(AI_TOOLS as readonly string[]).includes(String(t)));
        if (bad.length) issues.push({ nodeId: n.id, message: `Herramientas no permitidas: ${bad.join(", ")}` });
        if (typeof d.instructions === "string" && d.instructions.length > 4000) issues.push({ nodeId: n.id, message: "Instrucciones demasiado largas." });
        break;
      }
      case "condition": {
        const op = d.operator;
        if (!["contains_any", "equals", "starts_with", "is_empty", "not_empty"].includes(String(op))) issues.push({ nodeId: n.id, message: "Operador de condición inválido." });
        if (!["message", "intent", "variable"].includes(String(d.source))) issues.push({ nodeId: n.id, message: "Origen de condición inválido." });
        if (d.source === "variable" && !(typeof d.variable === "string" && /^[a-z_][a-z0-9_]{0,40}$/i.test(d.variable))) issues.push({ nodeId: n.id, message: "Indicá un nombre de variable válido." });
        if (["contains_any", "equals", "starts_with"].includes(String(op)) && !(typeof d.value === "string" && d.value.trim())) issues.push({ nodeId: n.id, message: "La condición necesita un valor a comparar." });
        break;
      }
      case "opportunity": {
        if (d.stageId && opts.stageIds && !opts.stageIds.has(String(d.stageId))) issues.push({ nodeId: n.id, message: "La etapa elegida ya no existe en el pipeline." });
        if (d.amount !== undefined && d.amount !== null && (typeof d.amount !== "number" || d.amount < 0 || !Number.isFinite(d.amount))) issues.push({ nodeId: n.id, message: "Importe inválido." });
        break;
      }
      case "handoff": {
        if (!(typeof d.reason === "string" && d.reason.trim())) issues.push({ nodeId: n.id, message: "Indicá el motivo de la transferencia." });
        break;
      }
      case "wait": {
        const t = Number(d.timeoutMinutes);
        if (!Number.isInteger(t) || t < 1 || t > 10080) issues.push({ nodeId: n.id, message: "La espera debe ser de 1 minuto a 7 días." });
        break;
      }
    }
  }

  // aristas
  const outs = new Map<string, FlowEdge[]>();
  const seenHandles = new Set<string>();
  for (const e of g.edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) {
      issues.push({ edgeId: e.id, message: "Conexión a un nodo inexistente." });
      continue;
    }
    const handle = e.sourceHandle || "out";
    const allowed = NODE_OUTPUTS[src.type].map((h) => h.id);
    if (!allowed.includes(handle)) issues.push({ edgeId: e.id, nodeId: src.id, message: `El nodo ${src.type} no tiene la salida "${handle}".` });
    if (tgt.type === "start") issues.push({ edgeId: e.id, nodeId: tgt.id, message: "No se puede conectar hacia el Inicio." });
    if (e.source === e.target) issues.push({ edgeId: e.id, nodeId: src.id, message: "Un nodo no puede conectarse consigo mismo." });
    const key = `${e.source}:${handle}`;
    if (seenHandles.has(key)) issues.push({ edgeId: e.id, nodeId: src.id, message: "Una salida solo puede tener una conexión." });
    seenHandles.add(key);
    outs.set(e.source, [...(outs.get(e.source) ?? []), { ...e, sourceHandle: handle }]);
  }

  // salidas obligatorias
  for (const n of byId.values()) {
    for (const h of NODE_OUTPUTS[n.type]) {
      if (h.optional) continue;
      if (!(outs.get(n.id) ?? []).some((e) => e.sourceHandle === h.id)) issues.push({ nodeId: n.id, message: `Falta conectar la salida "${h.label}".` });
    }
  }

  // alcanzabilidad
  if (starts.length === 1) {
    const seen = new Set<string>();
    const stack = [starts[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of outs.get(id) ?? []) stack.push(e.target);
    }
    for (const n of byId.values()) if (!seen.has(n.id)) issues.push({ nodeId: n.id, message: "Nodo inalcanzable desde el Inicio." });
  }

  // ciclos sin "esperar respuesta": se buscan ciclos en el subgrafo sin nodos wait
  const color = new Map<string, number>();
  const cycleNodes = new Set<string>();
  const dfs = (id: string, path: string[]) => {
    color.set(id, 1);
    for (const e of outs.get(id) ?? []) {
      const t = byId.get(e.target);
      if (!t || t.type === "wait") continue;
      if (color.get(t.id) === 1) {
        const idx = path.indexOf(t.id);
        path.slice(idx === -1 ? 0 : idx).forEach((x) => cycleNodes.add(x));
        cycleNodes.add(t.id);
      } else if (!color.get(t.id)) dfs(t.id, [...path, t.id]);
    }
    color.set(id, 2);
  };
  for (const n of byId.values()) if (n.type !== "wait" && !color.get(n.id)) dfs(n.id, [n.id]);
  if (cycleNodes.size) {
    for (const id of cycleNodes) issues.push({ nodeId: id, message: "Bucle sin \"Esperar respuesta\": el bot podría repetirse sin fin." });
  }
  return issues;
}

export function nextNodeId(graph: FlowGraph, nodeId: string, handle = "out"): string | null {
  const e = graph.edges.find((x) => x.source === nodeId && (x.sourceHandle || "out") === handle);
  return e?.target ?? null;
}
