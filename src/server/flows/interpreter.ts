import { MAX_RUN_STEPS, type FlowGraph, type FlowNode, type NodeData } from "@/lib/flow/types";
import { nextNodeId } from "@/lib/flow/validate";

export type FlowContext = {
  lastMessage: string;
  intent?: string | null;
  contactName?: string | null;
  aiReply?: string | null;
  vars: Record<string, string>;
};

export type RunState = { currentNodeId: string | null; context: FlowContext; stepCount: number };

export type AiNodeResult = {
  reply?: string | null;
  intent?: string | null;
  handoff?: { reason: string; code?: string } | null;
  /** Fotos de productos a enviar después de la respuesta. */
  attachments?: { productId: string; title: string }[];
};

export type FlowEffects = {
  /** ¿El bot sigue a cargo? (falso si un humano tomó la conversación o se pausó) */
  stillInControl(): Promise<boolean>;
  sendMessage(text: string, idempotencyKey: string): Promise<void>;
  /** Envía la foto de un producto (opcional: solo runtime/simulador que lo soporten). */
  sendAttachment?(a: { productId: string; title: string }, idempotencyKey: string): Promise<void>;
  ai(node: FlowNode<"ai">, ctx: FlowContext, idempotencyKey: string): Promise<AiNodeResult>;
  opportunity(data: NodeData["opportunity"], ctx: FlowContext): Promise<void>;
  /** Deriva a un humano. `code` identifica el motivo; `aiReplied` indica si la IA ya respondió en este paso. */
  handoff(reason: string, meta: { code: string; aiReplied: boolean }): Promise<void>;
  /** Persiste el estado tras cada paso (durabilidad / reintentos sin repetir pasos). */
  checkpoint(state: RunState, step: { nodeId: string; nodeType: string; summary: string }): Promise<void>;
  now(): Date;
};

export type RunOutcome =
  | { status: "completed" }
  | { status: "handed_off"; reason: string }
  | { status: "waiting"; resumeAt: Date; nodeId: string }
  | { status: "cancelled"; reason: string }
  | { status: "failed"; reason: string };

export function renderTemplate(text: string, ctx: FlowContext) {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_m, key: string) => {
    if (key === "contact.name") return ctx.contactName ?? "";
    if (key === "intent") return ctx.intent ?? "";
    if (key.startsWith("vars.")) return ctx.vars[key.slice(5)] ?? "";
    return "";
  });
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

export function evaluateCondition(d: NodeData["condition"], ctx: FlowContext): boolean {
  const subject = d.source === "message" ? ctx.lastMessage : d.source === "intent" ? (ctx.intent ?? "") : (ctx.vars[d.variable ?? ""] ?? "");
  const s = norm(subject);
  const v = norm(d.value ?? "");
  switch (d.operator) {
    case "is_empty":
      return s.length === 0;
    case "not_empty":
      return s.length > 0;
    case "equals":
      return s === v;
    case "starts_with":
      return s.startsWith(v);
    case "contains_any":
      return v
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .some((k) => s.includes(k));
  }
}

/**
 * Ejecuta el grafo publicado desde el estado dado hasta: fin, transferencia, espera,
 * cancelación (humano tomó control) o error. Cada paso se persiste antes de seguir.
 */
export async function runFlow(graph: FlowGraph, state: RunState, effects: FlowEffects, input: { mode: "start" | "reply" | "timeout" | "continue"; message?: string; runKey: string }): Promise<{ state: RunState; outcome: RunOutcome }> {
  const st: RunState = { ...state, context: { ...state.context, vars: { ...state.context.vars } } };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (input.mode === "start") {
    const start = graph.nodes.find((n) => n.type === "start");
    if (!start) return { state: st, outcome: { status: "failed", reason: "El flujo no tiene inicio." } };
    st.currentNodeId = start.id;
    st.context.lastMessage = input.message ?? "";
  } else if (input.mode === "continue") {
    // reintento tras un error: se sigue desde el último paso persistido (sin repetir los anteriores)
    if (!st.currentNodeId) return { state: st, outcome: { status: "completed" } };
  } else {
    // reanudación desde un nodo "esperar"
    const waitNode = st.currentNodeId ? byId.get(st.currentNodeId) : undefined;
    if (!waitNode || waitNode.type !== "wait") return { state: st, outcome: { status: "failed", reason: "La ejecución no estaba esperando respuesta." } };
    if (input.mode === "reply") st.context.lastMessage = input.message ?? "";
    const next = nextNodeId(graph, waitNode.id, input.mode === "reply" ? "reply" : "timeout");
    if (!next) return { state: { ...st, currentNodeId: null }, outcome: { status: "completed" } };
    st.currentNodeId = next;
  }

  let guard = 0;
  while (st.currentNodeId) {
    if (++guard > MAX_RUN_STEPS || st.stepCount >= MAX_RUN_STEPS * 3) {
      return { state: st, outcome: { status: "failed", reason: "Se alcanzó el máximo de pasos por ejecución." } };
    }
    if (!(await effects.stillInControl())) return { state: st, outcome: { status: "cancelled", reason: "Un humano tomó la conversación o el bot fue pausado." } };
    const node = byId.get(st.currentNodeId);
    if (!node) return { state: st, outcome: { status: "failed", reason: "Nodo inexistente en la versión publicada." } };
    const key = `${input.runKey}:${node.id}:${st.stepCount}`;
    let handle: string | null = "out";
    let summary = "";

    switch (node.type) {
      case "start":
        summary = "inicio";
        break;
      case "message": {
        const text = renderTemplate((node.data as NodeData["message"]).text, st.context).trim();
        if (text) await effects.sendMessage(text, key);
        summary = "mensaje enviado";
        break;
      }
      case "ai": {
        const n = node as FlowNode<"ai">;
        const res = await effects.ai(n, st.context, key);
        if (res.intent !== undefined) st.context.intent = res.intent;
        delete st.context.vars.ai_replied;
        delete st.context.vars.handoff_code;
        if (res.reply) {
          st.context.aiReply = res.reply;
          if (n.data.sendReply) {
            await effects.sendMessage(res.reply, `${key}:reply`);
            st.context.vars.ai_replied = "1";
          }
        }
        if (n.data.sendReply && res.attachments?.length && effects.sendAttachment) {
          for (const [i, a] of res.attachments.slice(0, 3).entries()) await effects.sendAttachment(a, `${key}:att${i}`);
        }
        if (res.handoff) {
          st.context.vars.handoff_reason = res.handoff.reason;
          st.context.vars.handoff_code = res.handoff.code ?? "ai";
          handle = "handoff";
        }
        summary = `IA${res.intent ? ` (intención: ${res.intent})` : ""}${res.handoff ? " → pide humano" : ""}`;
        break;
      }
      case "condition": {
        const ok = evaluateCondition(node.data as NodeData["condition"], st.context);
        handle = ok ? "true" : "false";
        summary = `condición: ${ok ? "sí" : "no"}`;
        break;
      }
      case "opportunity":
        await effects.opportunity(node.data as NodeData["opportunity"], st.context);
        summary = "oportunidad actualizada";
        break;
      case "handoff": {
        const reason = renderTemplate((node.data as NodeData["handoff"]).reason, st.context) || st.context.vars.handoff_reason || "Transferencia a humano";
        const code = st.context.vars.handoff_code || (node.id === "kw-handoff" ? "keyword" : "flow");
        await effects.handoff(reason, { code, aiReplied: st.context.vars.ai_replied === "1" });
        st.stepCount++;
        await effects.checkpoint({ ...st, currentNodeId: null }, { nodeId: node.id, nodeType: node.type, summary: "transferido a humano" });
        return { state: { ...st, currentNodeId: null }, outcome: { status: "handed_off", reason } };
      }
      case "wait": {
        const minutes = (node.data as NodeData["wait"]).timeoutMinutes;
        st.stepCount++;
        await effects.checkpoint(st, { nodeId: node.id, nodeType: node.type, summary: "esperando respuesta" });
        return { state: st, outcome: { status: "waiting", resumeAt: new Date(effects.now().getTime() + minutes * 60_000), nodeId: node.id } };
      }
      case "end":
        st.stepCount++;
        await effects.checkpoint({ ...st, currentNodeId: null }, { nodeId: node.id, nodeType: node.type, summary: "fin" });
        return { state: { ...st, currentNodeId: null }, outcome: { status: "completed" } };
    }
    st.stepCount++;
    const next = handle ? nextNodeId(graph, node.id, handle) : null;
    st.currentNodeId = next;
    await effects.checkpoint(st, { nodeId: node.id, nodeType: node.type, summary });
  }
  return { state: st, outcome: { status: "completed" } };
}
