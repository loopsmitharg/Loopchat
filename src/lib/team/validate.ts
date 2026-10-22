import { tokenize } from "@/lib/moderation/detect";
import { TEAM_INTENTS, type TeamGraph } from "./types";

export type TeamIssue = { severity: "error" | "warning"; message: string; nodeId?: string; edgeId?: string };

export type TeamBotInfo = {
  id: string;
  name: string;
  role: string;
  published: boolean;
  allowedTools: string[];
  /** pipelines configurados (principal + adicionales); vacío = pipeline principal de la empresa */
  pipelineIds: string[];
  /** etapas a las que puede mover */
  allowedStageIds: string[];
  /** etapa inicial / de cotización configuradas */
  stageRefs: string[];
};

export type TeamValidationContext = {
  bots: Map<string, TeamBotInfo>;
  pipelines: Set<string>;
  stages: Map<string, { pipelineId: string; kind: string }>;
  defaultPipelineId: string | null;
};

const SALES_TOOLS = ["create_opportunity", "update_stage"];

/** Detecta un ciclo dirigido en un subconjunto de aristas. */
function hasCycle(edges: { source: string; target: string }[]) {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    state.set(n, 1);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m);
      if (s === 1) return true;
      if (!s && visit(m)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const n of adj.keys()) if (!state.get(n) && visit(n)) return true;
  return false;
}

/**
 * Validación del equipo (servidor y editor). Con errores no se puede publicar:
 * entrada inválida, conexiones a nodos o bots inexistentes, condiciones vacías, bucles que
 * no se pueden resolver, pipelines eliminados o herramientas sin permisos.
 */
export function validateTeamGraph(graph: TeamGraph, ctx: TeamValidationContext): TeamIssue[] {
  const issues: TeamIssue[] = [];
  const err = (message: string, ref: { nodeId?: string; edgeId?: string } = {}) => issues.push({ severity: "error", message, ...ref });
  const warn = (message: string, ref: { nodeId?: string; edgeId?: string } = {}) => issues.push({ severity: "warning", message, ...ref });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const botNodes = graph.nodes.filter((n) => n.type === "bot");

  if (!botNodes.length) err("Agregá al menos un bot al equipo.");
  if (graph.nodes.filter((n) => n.type === "human").length > 1) err("Solo puede haber un nodo de atención humana.");
  const entry = graph.settings.entryNodeId ? byId.get(graph.settings.entryNodeId) : undefined;
  if (!entry || entry.type !== "bot") err("Elegí qué bot recibe los mensajes (bot de entrada).");
  else if (entry.data.disabled) err("El bot de entrada está deshabilitado.", { nodeId: entry.id });
  if (!Number.isInteger(graph.settings.maxConsecutiveTransfers) || graph.settings.maxConsecutiveTransfers < 1 || graph.settings.maxConsecutiveTransfers > 10) err("El límite de derivaciones seguidas debe estar entre 1 y 10.");

  const seen = new Set<string>();
  for (const n of botNodes) {
    if (n.type !== "bot") continue;
    const b = ctx.bots.get(n.data.botId);
    if (!b) {
      err("Este nodo apunta a un bot que ya no existe.", { nodeId: n.id });
      continue;
    }
    if (seen.has(b.id)) err(`"${b.name}" está dos veces en el equipo.`, { nodeId: n.id });
    seen.add(b.id);
    if (!b.published) err(`"${b.name}" no tiene una versión publicada.`, { nodeId: n.id });
    for (const p of b.pipelineIds) if (!ctx.pipelines.has(p)) err(`"${b.name}" usa un pipeline que fue eliminado.`, { nodeId: n.id });
    const own = b.pipelineIds.length ? b.pipelineIds : ctx.defaultPipelineId ? [ctx.defaultPipelineId] : [];
    for (const s of [...b.allowedStageIds, ...b.stageRefs]) {
      const st = ctx.stages.get(s);
      if (!st) err(`"${b.name}" referencia una etapa eliminada.`, { nodeId: n.id });
      else if (!own.includes(st.pipelineId)) err(`"${b.name}" puede mover oportunidades a una etapa de un pipeline que no tiene autorizado.`, { nodeId: n.id });
    }
    if (b.role === "receptionist" && b.allowedTools.some((t) => SALES_TOOLS.includes(t))) err(`"${b.name}" es recepcionista: no puede crear ni mover oportunidades. Quitale esas herramientas o cambiá su rol.`, { nodeId: n.id });
  }

  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      err("Hay una conexión hacia un nodo que no existe.", { edgeId: e.id });
      continue;
    }
    if (s.type === "human") err("La atención humana no deriva a bots: la conversación vuelve a un bot solo por acción de una persona.", { edgeId: e.id });
    if (e.source === e.target) err("Un bot no puede derivarse a sí mismo.", { edgeId: e.id });
    const c = e.data.condition;
    if (c.kind === "intent" && (!c.intents.length || c.intents.some((i) => !(TEAM_INTENTS as readonly string[]).includes(i)))) err("Elegí al menos una necesidad para esta derivación.", { edgeId: e.id });
    if (c.kind === "keywords" && !c.keywords.some((k) => k.trim().length >= 2)) err("Escribí al menos una palabra clave para esta derivación.", { edgeId: e.id });
    if (c.kind === "ai" && c.description.trim().length < 5) err("Describí en una frase cuándo derivar (lo evalúa la IA).", { edgeId: e.id });
  }
  const dup = new Set<string>();
  for (const e of graph.edges) {
    const k = `${e.source}->${e.target}`;
    if (dup.has(k)) err("Hay dos derivaciones iguales entre los mismos nodos: unificá las condiciones en una.", { edgeId: e.id });
    dup.add(k);
  }

  // bucles irresolubles: ciclo de derivaciones que comparten la misma necesidad o palabra clave
  const enabled = graph.edges.filter((e) => e.data.enabled && byId.get(e.source)?.type === "bot" && byId.get(e.target)?.type === "bot");
  for (const intent of TEAM_INTENTS) {
    const sub = enabled.filter((e) => e.data.condition.kind === "intent" && e.data.condition.intents.includes(intent));
    if (hasCycle(sub)) err(`Bucle de derivaciones para "${intent}": los bots se pasarían la conversación sin fin. Quitá esa necesidad de una de las conexiones.`);
  }
  const kw = new Map<string, { source: string; target: string }[]>();
  for (const e of enabled) {
    if (e.data.condition.kind !== "keywords") continue;
    for (const k of e.data.condition.keywords) {
      const key = tokenize(k).join(" ");
      if (key) kw.set(key, [...(kw.get(key) ?? []), e]);
    }
  }
  for (const [k, es] of kw) if (hasCycle(es)) err(`Bucle de derivaciones con la palabra "${k}".`);

  // nodos inalcanzables desde la entrada
  if (entry) {
    const reach = new Set([entry.id]);
    const queue = [entry.id];
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of graph.edges.filter((x) => x.source === n && x.data.enabled)) {
        if (reach.has(e.target)) continue;
        reach.add(e.target);
        queue.push(e.target);
      }
    }
    for (const n of botNodes) if (n.type === "bot" && n.data.disabled) warn("Bot deshabilitado: las derivaciones hacia él usan el respaldo (bot de entrada o una persona).", { nodeId: n.id });
    for (const n of botNodes) if (!reach.has(n.id)) warn("Ningún bot deriva a este: nunca va a recibir conversaciones.", { nodeId: n.id });
  }

  const teamBots = new Set(botNodes.map((n) => (n.type === "bot" ? n.data.botId : "")));
  for (const a of graph.automations) {
    if (a.trigger.kind === "stage_entered" && !ctx.stages.has(a.trigger.stageId)) err("Una automatización usa una etapa eliminada.");
    if (a.trigger.kind === "opportunity_closed" && a.trigger.pipelineId && !ctx.pipelines.has(a.trigger.pipelineId)) err("Una automatización usa un pipeline eliminado.");
    if ((a.action.kind === "activate_bot" || (a.action.kind === "stop_bot" && a.action.botId)) && !teamBots.has((a.action as { botId: string }).botId)) err("Una automatización usa un bot que no está en el equipo.");
  }
  return issues;
}
