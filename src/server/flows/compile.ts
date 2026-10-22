import type { AiTool, FlowGraph } from "@/lib/flow/types";

/**
 * Bot "por instrucciones" (atajo sin editor): se compila a un grafo estándar que ejecuta
 * el mismo runtime que los flujos visuales.
 */
export function compileInstructionsBot(input: { tools: AiTool[]; handoffKeywords: string[] }): FlowGraph {
  const nodes: FlowGraph["nodes"] = [
    { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
    { id: "ai", type: "ai", position: { x: 0, y: 260 }, data: { sendReply: true, tools: input.tools } },
    { id: "handoff", type: "handoff", position: { x: 260, y: 400 }, data: { reason: "{{vars.handoff_reason}}" } },
    { id: "end", type: "end", position: { x: 0, y: 400 }, data: {} },
  ];
  const edges: FlowGraph["edges"] = [
    { id: "e-ai-out", source: "ai", target: "end", sourceHandle: "out" },
    { id: "e-ai-handoff", source: "ai", target: "handoff", sourceHandle: "handoff" },
  ];
  const keywords = input.handoffKeywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length) {
    nodes.push({ id: "kw", type: "condition", position: { x: 0, y: 120 }, data: { source: "message", operator: "contains_any", value: keywords.join(", ") } });
    nodes.push({ id: "kw-handoff", type: "handoff", position: { x: 260, y: 120 }, data: { reason: "El cliente pidió hablar con una persona" } });
    edges.push({ id: "e-start", source: "start", target: "kw", sourceHandle: "out" });
    edges.push({ id: "e-kw-true", source: "kw", target: "kw-handoff", sourceHandle: "true" });
    edges.push({ id: "e-kw-false", source: "kw", target: "ai", sourceHandle: "false" });
  } else {
    edges.push({ id: "e-start", source: "start", target: "ai", sourceHandle: "out" });
  }
  return { nodes, edges };
}
