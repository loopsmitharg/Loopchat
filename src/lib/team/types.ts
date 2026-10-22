/**
 * Equipo de chatbots: grafo versionado que el editor visual (React Flow) y el orquestador usan
 * con exactamente este formato. Cada nodo "bot" referencia un bot existente de la empresa;
 * el nodo "human" representa la atención humana. Las conexiones son derivaciones con condición.
 */
export const TEAM_INTENTS = ["ventas", "atencion", "soporte", "turnos", "seguimiento", "consulta"] as const;
export type TeamIntent = (typeof TEAM_INTENTS)[number];

export const INTENT_LABELS: Record<TeamIntent, string> = {
  ventas: "Ventas (precios, compras, presupuestos)",
  atencion: "Atención al cliente (reclamos, pedidos, envíos, devoluciones)",
  soporte: "Soporte técnico (fallas, reparaciones, uso)",
  turnos: "Turnos y reservas",
  seguimiento: "Seguimiento (presupuestos o contactos anteriores)",
  consulta: "Consulta general",
};

export type RouteCondition =
  | { kind: "intent"; intents: TeamIntent[] }
  | { kind: "keywords"; keywords: string[] }
  | { kind: "ai"; description: string };

export type TeamBotNode = { id: string; type: "bot"; position: { x: number; y: number }; data: { botId: string; /** Deshabilitado en el equipo: no recibe derivaciones (se usa el respaldo). */ disabled?: boolean } };
export type TeamHumanNode = { id: string; type: "human"; position: { x: number; y: number }; data: Record<string, never> };
export type TeamNode = TeamBotNode | TeamHumanNode;

export type TeamEdge = { id: string; source: string; target: string; data: { condition: RouteCondition; enabled: boolean; label?: string; /** Mensaje fijo (sin IA) al derivar. Vacío = derivación silenciosa. */ message?: string } };

export type TeamAutomation = {
  id: string;
  enabled: boolean;
  trigger: { kind: "stage_entered"; stageId: string } | { kind: "opportunity_closed"; pipelineId: string | null };
  action: { kind: "activate_bot"; botId: string } | { kind: "assign_owner"; userId: string } | { kind: "stop_bot"; botId: string | null };
};

export type TeamSettings = {
  /** Nodo (bot) que recibe los mensajes nuevos. */
  entryNodeId: string | null;
  /** El bot de entrada no identifica la necesidad: responde él (pregunta) o pasa a una persona. */
  unknownIntent: "stay" | "human";
  /** Derivaciones internas seguidas sin que un bot responda antes de pasar a una persona. */
  maxConsecutiveTransfers: number;
  /** Si el bot de destino no está disponible: volver al bot de entrada o a una persona. */
  fallback: "entry" | "human";
};

export type TeamGraph = { nodes: TeamNode[]; edges: TeamEdge[]; settings: TeamSettings; automations: TeamAutomation[] };

export const DEFAULT_TEAM_SETTINGS: TeamSettings = { entryNodeId: null, unknownIntent: "stay", maxConsecutiveTransfers: 3, fallback: "entry" };

export const ROLE_LABELS: Record<string, string> = {
  receptionist: "Recepcionista",
  sales: "Ventas",
  customer_service: "Atención al cliente",
  support: "Soporte técnico",
  followup: "Seguimiento comercial",
  aftersales: "Posventa",
  custom: "Personalizado",
};

export function emptyTeamGraph(): TeamGraph {
  return { nodes: [{ id: "human", type: "human", position: { x: 520, y: 320 }, data: {} }], edges: [], settings: { ...DEFAULT_TEAM_SETTINGS }, automations: [] };
}

export function describeCondition(c: RouteCondition) {
  if (c.kind === "intent") return c.intents.map((i) => INTENT_LABELS[i].split(" (")[0]).join(" / ") || "Sin intención";
  if (c.kind === "keywords") return c.keywords.length ? `Palabras: ${c.keywords.slice(0, 3).join(", ")}${c.keywords.length > 3 ? "…" : ""}` : "Sin palabras";
  return c.description ? `IA: ${c.description.slice(0, 40)}` : "IA (sin descripción)";
}
