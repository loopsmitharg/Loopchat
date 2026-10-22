import { describe, expect, it } from "vitest";
import type { FlowGraph, FlowNode } from "@/lib/flow/types";
import { validateGraph } from "@/lib/flow/validate";
import { evaluateCondition, renderTemplate, runFlow, type FlowEffects } from "@/server/flows/interpreter";
import { compileInstructionsBot } from "@/server/flows/compile";

const n = (id: string, type: FlowNode["type"], data: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data } as FlowNode);

function effects(over: Partial<FlowEffects> = {}) {
  const sent: string[] = [];
  const log: string[] = [];
  const e: FlowEffects = {
    now: () => new Date("2026-10-20T12:00:00Z"),
    stillInControl: async () => true,
    sendMessage: async (t) => void sent.push(t),
    ai: async () => ({ reply: "respuesta IA", intent: "precio" }),
    opportunity: async () => void log.push("opp"),
    handoff: async (r) => void log.push(`handoff:${r}`),
    checkpoint: async () => undefined,
    ...over,
  };
  return { e, sent, log };
}

describe("validador de flujos", () => {
  it("grafo mínimo válido", () => {
    expect(validateGraph({ nodes: [n("s", "start"), n("e", "end")], edges: [{ id: "1", source: "s", target: "e" }] })).toEqual([]);
  });
  it("detecta inicio faltante/duplicado, salidas sin conectar, nodos inalcanzables y conexiones inválidas", () => {
    const g: FlowGraph = {
      nodes: [n("s", "start"), n("c", "condition", { source: "message", operator: "equals", value: "" }), n("x", "message", { text: "hola" }), n("lost", "end")],
      edges: [
        { id: "1", source: "s", target: "c" },
        { id: "2", source: "c", target: "x", sourceHandle: "true" },
        { id: "3", source: "x", target: "s" },
        { id: "4", source: "c", target: "ghost", sourceHandle: "false" },
        { id: "5", source: "x", target: "x", sourceHandle: "bogus" },
      ],
    };
    const msgs = validateGraph(g).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/necesita un valor/);
    expect(msgs).toMatch(/No se puede conectar hacia el Inicio/);
    expect(msgs).toMatch(/nodo inexistente/);
    expect(msgs).toMatch(/no tiene la salida "bogus"/);
    expect(msgs).toMatch(/inalcanzable/);
    const two = validateGraph({ nodes: [n("s", "start"), n("s2", "start"), n("e", "end")], edges: [{ id: "1", source: "s", target: "e" }, { id: "2", source: "s2", target: "e" }] });
    expect(two.map((i) => i.message).join()).toMatch(/Solo puede haber un nodo de Inicio/);
    expect(validateGraph({ nodes: [n("e", "end")], edges: [] }).map((i) => i.message).join()).toMatch(/Falta el nodo de Inicio/);
  });
  it("rechaza bucles sin espera pero acepta bucles con 'Esperar respuesta'", () => {
    const loop: FlowGraph = {
      nodes: [n("s", "start"), n("a", "message", { text: "a" }), n("b", "message", { text: "b" })],
      edges: [
        { id: "1", source: "s", target: "a" },
        { id: "2", source: "a", target: "b" },
        { id: "3", source: "b", target: "a" },
      ],
    };
    expect(validateGraph(loop).some((i) => /Bucle/.test(i.message))).toBe(true);
    const ok: FlowGraph = {
      nodes: [n("s", "start"), n("a", "message", { text: "¿Algo más?" }), n("w", "wait", { timeoutMinutes: 5 }), n("e", "end")],
      edges: [
        { id: "1", source: "s", target: "a" },
        { id: "2", source: "a", target: "w" },
        { id: "3", source: "w", target: "a", sourceHandle: "reply" },
        { id: "4", source: "w", target: "e", sourceHandle: "timeout" },
      ],
    };
    expect(validateGraph(ok)).toEqual([]);
  });
  it("valida herramientas de IA y etapas existentes", () => {
    const g: FlowGraph = {
      nodes: [n("s", "start"), n("ai", "ai", { sendReply: true, tools: ["borrar_todo"] }), n("o", "opportunity", { action: "create_or_update", stageId: "no-existe" }), n("h", "handoff", { reason: "x" }), n("e", "end")],
      edges: [
        { id: "1", source: "s", target: "ai" },
        { id: "2", source: "ai", target: "o", sourceHandle: "out" },
        { id: "3", source: "ai", target: "h", sourceHandle: "handoff" },
        { id: "4", source: "o", target: "e" },
      ],
    };
    const msgs = validateGraph(g, { stageIds: new Set(["otra"]) }).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/Herramientas no permitidas: borrar_todo/);
    expect(msgs).toMatch(/etapa elegida ya no existe/);
  });
  it("el bot por instrucciones compila a un grafo válido", () => {
    expect(validateGraph(compileInstructionsBot({ tools: ["classify", "handoff"], handoffKeywords: ["asesor"] }))).toEqual([]);
    expect(validateGraph(compileInstructionsBot({ tools: [], handoffKeywords: [] }))).toEqual([]);
  });
});

describe("intérprete", () => {
  it("condiciones sin acentos ni mayúsculas y plantillas", () => {
    const ctx = { lastMessage: "Quiero el PRESUPUESTO por favor", intent: "precio", vars: { nombre: "Ana" }, contactName: "Ana" };
    expect(evaluateCondition({ source: "message", operator: "contains_any", value: "precio, presupuesto" }, ctx)).toBe(true);
    expect(evaluateCondition({ source: "intent", operator: "equals", value: "Precio" }, ctx)).toBe(true);
    expect(evaluateCondition({ source: "variable", variable: "nombre", operator: "starts_with", value: "an" }, ctx)).toBe(true);
    expect(evaluateCondition({ source: "message", operator: "is_empty" }, ctx)).toBe(false);
    expect(renderTemplate("Hola {{contact.name}} ({{intent}}) {{vars.nombre}} {{desconocido}}", ctx)).toBe("Hola Ana (precio) Ana ");
  });

  const graph: FlowGraph = {
    nodes: [n("s", "start"), n("c", "condition", { source: "message", operator: "contains_any", value: "humano" }), n("h", "handoff", { reason: "Pidió humano" }), n("m", "message", { text: "Hola {{contact.name}}" }), n("w", "wait", { timeoutMinutes: 10 }), n("ai", "ai", { sendReply: true, tools: [] }), n("e", "end")],
    edges: [
      { id: "1", source: "s", target: "c" },
      { id: "2", source: "c", target: "h", sourceHandle: "true" },
      { id: "3", source: "c", target: "m", sourceHandle: "false" },
      { id: "4", source: "m", target: "w" },
      { id: "5", source: "w", target: "ai", sourceHandle: "reply" },
      { id: "6", source: "ai", target: "e", sourceHandle: "out" },
      { id: "7", source: "ai", target: "h", sourceHandle: "handoff" },
    ],
  };
  const base = { currentNodeId: null, context: { lastMessage: "", vars: {}, contactName: "Ana" }, stepCount: 0 };

  it("ruta de derivación", async () => {
    const { e, log, sent } = effects();
    const r = await runFlow(graph, base, e, { mode: "start", message: "quiero un HUMANO", runKey: "k" });
    expect(r.outcome).toMatchObject({ status: "handed_off", reason: "Pidió humano" });
    expect(log).toContain("handoff:Pidió humano");
    expect(sent).toHaveLength(0);
  });

  it("espera, reanuda con la respuesta y termina; checkpoints por paso", async () => {
    const checkpoints: string[] = [];
    const { e, sent } = effects({ checkpoint: async (_s, step) => void checkpoints.push(step.nodeType) });
    const r1 = await runFlow(graph, base, e, { mode: "start", message: "hola", runKey: "k" });
    expect(r1.outcome.status).toBe("waiting");
    expect(sent).toEqual(["Hola Ana"]);
    const r2 = await runFlow(graph, r1.state, e, { mode: "reply", message: "precio?", runKey: "k" });
    expect(r2.outcome.status).toBe("completed");
    expect(sent).toEqual(["Hola Ana", "respuesta IA"]);
    expect(r2.state.context.intent).toBe("precio");
    expect(checkpoints).toEqual(["start", "condition", "message", "wait", "ai", "end"]);
  });

  it("timeout sin salida conectada termina; humano toma control cancela", async () => {
    const { e } = effects();
    const r1 = await runFlow(graph, base, e, { mode: "start", message: "hola", runKey: "k" });
    const r2 = await runFlow(graph, r1.state, e, { mode: "timeout", runKey: "k" });
    expect(r2.outcome.status).toBe("completed");
    const c = effects({ stillInControl: async () => false });
    const r3 = await runFlow(graph, base, c.e, { mode: "start", message: "hola", runKey: "k" });
    expect(r3.outcome.status).toBe("cancelled");
    expect(c.sent).toHaveLength(0);
  });

  it("reintento ('continue') sigue desde el último paso persistido sin repetir envíos", async () => {
    const { e, sent } = effects();
    const r = await runFlow(graph, { ...base, currentNodeId: "ai", context: { ...base.context, lastMessage: "x" } }, e, { mode: "continue", runKey: "k" });
    expect(r.outcome.status).toBe("completed");
    expect(sent).toEqual(["respuesta IA"]);
  });

  it("IA pide humano → sale por 'handoff'", async () => {
    const { e, log } = effects({ ai: async () => ({ reply: null, handoff: { reason: "reclamo" } }) });
    const g2: FlowGraph = { ...graph, edges: graph.edges.map((x) => (x.id === "1" ? { ...x, target: "ai" } : x)) };
    const r = await runFlow(g2, base, e, { mode: "start", message: "tengo un reclamo", runKey: "k" });
    expect(r.outcome.status).toBe("handed_off");
    expect(log.join()).toMatch(/handoff/);
  });

  it("guarda de pasos máximos", async () => {
    const g: FlowGraph = { nodes: [n("s", "start"), n("a", "message", { text: "a" }), n("b", "message", { text: "b" })], edges: [{ id: "1", source: "s", target: "a" }, { id: "2", source: "a", target: "b" }, { id: "3", source: "b", target: "a" }] };
    const { e } = effects();
    const r = await runFlow(g, base, e, { mode: "start", message: "x", runKey: "k" });
    expect(r.outcome).toMatchObject({ status: "failed" });
  });
});
