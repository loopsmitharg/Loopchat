/** Grafo de flujo versionado. El editor (React Flow) y el runtime usan exactamente este formato. */
export const NODE_TYPES = ["start", "message", "ai", "condition", "opportunity", "handoff", "wait", "end"] as const;
export type FlowNodeType = (typeof NODE_TYPES)[number];

export const AI_TOOLS = ["create_opportunity", "update_stage", "handoff", "create_task", "classify", "use_knowledge", "use_catalog", "collect_data"] as const;
export type AiTool = (typeof AI_TOOLS)[number];

export type ConditionSource = "message" | "intent" | "variable";
export type ConditionOperator = "contains_any" | "equals" | "starts_with" | "is_empty" | "not_empty";

export type NodeData = {
  start: { label?: string };
  message: { text: string };
  ai: { instructions?: string; sendReply: boolean; tools: AiTool[] };
  condition: { source: ConditionSource; variable?: string; operator: ConditionOperator; value?: string };
  opportunity: { action: "create_or_update"; stageId?: string | null; title?: string; amount?: number | null };
  handoff: { reason: string };
  wait: { timeoutMinutes: number };
  end: { label?: string };
};

export type FlowNode<T extends FlowNodeType = FlowNodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: NodeData[T];
};

export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null };

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

/** Salidas (handles) que cada tipo de nodo expone. Todas son obligatorias salvo las marcadas. */
export const NODE_OUTPUTS: Record<FlowNodeType, { id: string; label: string; optional?: boolean }[]> = {
  start: [{ id: "out", label: "Siguiente" }],
  message: [{ id: "out", label: "Siguiente" }],
  ai: [
    { id: "out", label: "Respondió" },
    { id: "handoff", label: "Pide humano" },
  ],
  condition: [
    { id: "true", label: "Sí" },
    { id: "false", label: "No" },
  ],
  opportunity: [{ id: "out", label: "Siguiente" }],
  handoff: [],
  wait: [
    { id: "reply", label: "Respondió" },
    { id: "timeout", label: "Sin respuesta", optional: true },
  ],
  end: [],
};

export const NODE_LABELS: Record<FlowNodeType, string> = {
  start: "Inicio",
  message: "Mensaje",
  ai: "IA",
  condition: "Condición",
  opportunity: "Oportunidad",
  handoff: "Asignar humano",
  wait: "Esperar respuesta",
  end: "Fin",
};

export const TOOL_LABELS: Record<AiTool, string> = {
  create_opportunity: "Crear/actualizar oportunidad",
  update_stage: "Mover etapa",
  handoff: "Pedir humano",
  create_task: "Crear tarea",
  classify: "Clasificar intención",
  use_knowledge: "Consultar conocimiento (FAQ/documentos)",
  use_catalog: "Consultar catálogo de productos",
  collect_data: "Recopilar datos comerciales",
};

export function defaultNodeData<T extends FlowNodeType>(type: T): NodeData[T] {
  const d: { [K in FlowNodeType]: NodeData[K] } = {
    start: {},
    message: { text: "" },
    ai: { sendReply: true, tools: ["classify", "use_knowledge", "handoff"] },
    condition: { source: "message", operator: "contains_any", value: "" },
    opportunity: { action: "create_or_update", stageId: null, title: "" },
    handoff: { reason: "" },
    wait: { timeoutMinutes: 60 },
    end: {},
  };
  return d[type];
}

export const MAX_RUN_STEPS = 60;
export const MAX_NODES = 80;
