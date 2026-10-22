import { classifyIntent, matchesKeywords } from "./intent";
import { describeCondition, INTENT_LABELS, type TeamEdge, type TeamGraph, type TeamIntent } from "./types";

/**
 * Motor de derivación del equipo (sin efectos: lo usan el runtime y el simulador).
 * Orden: 1) palabras clave, 2) intención detectada sin IA, 3) IA solo si las reglas no
 * alcanzan (bot de entrada/recepcionista, o conexiones de tipo "IA").
 * Protecciones: límite de derivaciones seguidas, bucles (un bot ya visitado en el mismo
 * mensaje) y bots no disponibles (vuelta al bot de entrada o a una persona).
 */
export type HopKind = "keyword" | "intent" | "ai" | "unknown" | "unavailable" | "loop_guard";
export type RouteHop = { from: string; to: string | null; toHuman: boolean; kind: HopKind; intent: TeamIntent | null; reason: string; /** mensaje fijo de transición configurado en la derivación (opcional) */ message?: string };
export type RouteResult = {
  /** Nodo (bot) que responde. null = pasa a una persona. */
  finalNodeId: string | null;
  toHuman: boolean;
  hops: RouteHop[];
  intent: TeamIntent | null;
  signals: string[];
  trivial: boolean;
  aiUsed: boolean;
};

export type AiOption = { index: number; edgeId: string; label: string };
export type AiRouteClassifier = (args: { nodeId: string; message: string; options: AiOption[] }) => Promise<{ index: number | null; intent?: TeamIntent | null } | null>;

export type RouteInput = {
  graph: TeamGraph;
  currentNodeId: string | null;
  message: string;
  /** Derivaciones seguidas previas sin que un bot respondiera. */
  streak: number;
  /** Nodo disponible (bot existente, con versión fijada y no deshabilitado). */
  isAvailable: (nodeId: string) => boolean;
  /** Nombre visible del nodo (para motivos legibles). */
  nameOf: (nodeId: string) => string;
  /** Rol del bot del nodo (la recepcionista puede clasificar con IA). */
  roleOf: (nodeId: string) => string;
  /** Clasificación por IA (con el proveedor de la empresa). Ausente = sin IA. */
  aiClassify?: AiRouteClassifier;
};

function edgeLabel(e: TeamEdge, nameOf: (id: string) => string) {
  const c = e.data.condition;
  const what = c.kind === "intent" ? c.intents.map((i) => INTENT_LABELS[i]).join("; ") : c.kind === "keywords" ? `mensajes que mencionan: ${c.keywords.join(", ")}` : c.description;
  return `${what} → ${nameOf(e.target)}`;
}

export async function routeTeamMessage(input: RouteInput): Promise<RouteResult> {
  const { graph } = input;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const entry = graph.settings.entryNodeId;
  const det = classifyIntent(input.message);
  let intent: TeamIntent | null = det.intent;
  const res: RouteResult = { finalNodeId: null, toHuman: false, hops: [], intent, signals: det.signals, trivial: det.trivial, aiUsed: false };
  const toHuman = (from: string, kind: HopKind, reason: string) => {
    res.hops.push({ from, to: null, toHuman: true, kind, intent, reason });
    res.toHuman = true;
    res.finalNodeId = null;
    res.intent = intent;
    return res;
  };

  const prev = input.currentNodeId;
  const prevOk = Boolean(prev && byId.get(prev)?.type === "bot" && input.isAvailable(prev));
  const start = prevOk ? prev : entry;
  if (!start || byId.get(start)?.type !== "bot" || !input.isAvailable(start)) return toHuman(prev ?? entry ?? "", "unavailable", "El equipo no tiene un bot de entrada disponible");
  let cur: string = start;
  if (prev && !prevOk) {
    // el bot activo ya no está disponible (eliminado o deshabilitado)
    if (input.graph.settings.fallback === "human") return toHuman(prev, "unavailable", `${input.nameOf(prev)} no está disponible`);
    res.hops.push({ from: prev, to: cur, toHuman: false, kind: "unavailable", intent, reason: `${input.nameOf(prev)} no está disponible: vuelve al bot de entrada` });
  }
  const visited = new Set([cur]);
  const max = graph.settings.maxConsecutiveTransfers;

  for (let guard = 0; guard < 20; guard++) {
    const out = graph.edges.filter((e) => e.source === cur && e.data.enabled && byId.has(e.target));
    let match: TeamEdge | undefined;
    let kind: HopKind = "keyword";
    let reason = "";
    // 1) palabras clave
    for (const e of out) {
      if (e.data.condition.kind === "keywords" && matchesKeywords(input.message, e.data.condition.keywords)) {
        match = e;
        reason = `Palabra clave (${describeCondition(e.data.condition)})`;
        break;
      }
    }
    // 2) intención sin IA (un reclamo con precio NO es venta: prioridad en classifyIntent)
    if (!match && intent) {
      match = out.find((e) => e.data.condition.kind === "intent" && e.data.condition.intents.includes(intent!));
      if (match) {
        kind = "intent";
        reason = `Necesidad detectada: ${INTENT_LABELS[intent].split(" (")[0]}${det.signals.length ? ` (${det.signals.slice(0, 3).join(", ")})` : ""}`;
      }
    }
    // 3) IA: solo en el primer paso, si el mensaje no es trivial y las reglas no alcanzaron
    if (!match && guard === 0 && !det.trivial && input.aiClassify && out.length) {
      const isRouter = cur === entry || input.roleOf(cur) === "receptionist";
      const candidates = isRouter ? out : out.filter((e) => e.data.condition.kind === "ai");
      if (candidates.length) {
        const options = candidates.map((e, i) => ({ index: i + 1, edgeId: e.id, label: edgeLabel(e, input.nameOf) }));
        const r = await input.aiClassify({ nodeId: cur, message: input.message, options });
        if (r) {
          res.aiUsed = true;
          if (r.intent && !intent) intent = r.intent;
          const opt = r.index ? options.find((o) => o.index === r.index) : undefined;
          if (opt) {
            match = candidates.find((e) => e.id === opt.edgeId);
            kind = "ai";
            reason = `Clasificado con IA: ${opt.label.split(" → ")[0].slice(0, 120)}`;
          }
        }
      }
    }
    if (!match) {
      if (guard === 0 && cur === entry && !intent && !det.trivial && out.length && graph.settings.unknownIntent === "human") return toHuman(cur, "unknown", "No se pudo identificar la necesidad del cliente");
      break;
    }
    const target = byId.get(match.target)!;
    if (target.type === "human") return toHuman(cur, kind, reason || "Derivación a una persona");
    if (input.streak + res.hops.length + 1 > max) return toHuman(cur, "loop_guard", `Se alcanzó el límite de ${max} derivaciones seguidas sin respuesta`);
    if (visited.has(target.id)) return toHuman(cur, "loop_guard", `Bucle de derivaciones detectado (${input.nameOf(cur)} → ${input.nameOf(target.id)})`);
    if (!input.isAvailable(target.id)) {
      const back = graph.settings.fallback === "entry" && entry && entry !== cur && !visited.has(entry) && input.isAvailable(entry);
      if (!back) return toHuman(cur, "unavailable", `${input.nameOf(target.id)} no está disponible`);
      res.hops.push({ from: cur, to: entry, toHuman: false, kind: "unavailable", intent, reason: `${input.nameOf(target.id)} no está disponible: vuelve al bot de entrada` });
      cur = entry!;
      break;
    }
    res.hops.push({ from: cur, to: target.id, toHuman: false, kind, intent, reason, ...(match.data.message?.trim() ? { message: match.data.message.trim() } : {}) });
    visited.add(target.id);
    cur = target.id;
  }
  res.finalNodeId = cur;
  res.intent = intent;
  return res;
}
