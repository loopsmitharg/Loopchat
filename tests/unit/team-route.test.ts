import { describe, expect, it } from "vitest";
import { classifyIntent } from "@/lib/team/intent";
import { routeTeamMessage, type RouteInput } from "@/lib/team/route";
import type { TeamGraph } from "@/lib/team/types";
import { validateTeamGraph, type TeamValidationContext } from "@/lib/team/validate";
import { parseAiDecision } from "@/server/flows/ai-step";

const graph = (over: Partial<TeamGraph> = {}): TeamGraph => ({
  nodes: [
    { id: "rec", type: "bot", position: { x: 0, y: 0 }, data: { botId: "b-rec" } },
    { id: "ven", type: "bot", position: { x: 0, y: 0 }, data: { botId: "b-ven" } },
    { id: "sop", type: "bot", position: { x: 0, y: 0 }, data: { botId: "b-sop" } },
    { id: "human", type: "human", position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: "e1", source: "rec", target: "ven", data: { condition: { kind: "intent", intents: ["ventas"] }, enabled: true } },
    { id: "e2", source: "rec", target: "sop", data: { condition: { kind: "intent", intents: ["soporte", "atencion"] }, enabled: true } },
    { id: "e3", source: "ven", target: "sop", data: { condition: { kind: "intent", intents: ["soporte"] }, enabled: true } },
    { id: "e4", source: "rec", target: "human", data: { condition: { kind: "keywords", keywords: ["hablar con alguien"] }, enabled: true } },
  ],
  settings: { entryNodeId: "rec", unknownIntent: "stay", maxConsecutiveTransfers: 3, fallback: "entry" },
  automations: [],
  ...over,
});

const input = (g: TeamGraph, message: string, extra: Partial<RouteInput> = {}): RouteInput => ({
  graph: g,
  currentNodeId: null,
  message,
  streak: 0,
  isAvailable: (id) => g.nodes.some((n) => n.id === id && n.type === "bot" && !n.data.disabled),
  nameOf: (id) => id,
  roleOf: (id) => (id === "rec" ? "receptionist" : "sales"),
  ...extra,
});

describe("intención sin IA", () => {
  it("un reclamo con precio NO es venta", () => {
    expect(classifyIntent("Compré una amoladora y dejó de funcionar, cuánto sale arreglarla?").intent).toBe("soporte");
    expect(classifyIntent("me cobraron dos veces el precio").intent).toBe("atencion");
    expect(classifyIntent("cuánto sale el taladro?").intent).toBe("ventas");
    expect(classifyIntent("hola buenas tardes")).toMatchObject({ intent: null, trivial: true });
  });
});

describe("motor de derivación", () => {
  it("deriva por intención y encadena solo con reglas", async () => {
    const r = await routeTeamMessage(input(graph(), "precio del taladro"));
    expect(r).toMatchObject({ finalNodeId: "ven", toHuman: false, intent: "ventas", aiUsed: false });
    expect(r.hops).toHaveLength(1);
  });

  it("palabra clave a persona tiene prioridad", async () => {
    const r = await routeTeamMessage(input(graph(), "quiero hablar con alguien sobre el precio"));
    expect(r.toHuman).toBe(true);
    expect(r.hops.at(-1)?.kind).toBe("keyword");
  });

  it("usa IA solo si las reglas no alcanzan y el mensaje no es trivial", async () => {
    let calls = 0;
    const ai = async () => {
      calls++;
      return { index: 1 };
    };
    expect((await routeTeamMessage(input(graph(), "hola", { aiClassify: ai }))).finalNodeId).toBe("rec");
    expect(calls).toBe(0);
    const r = await routeTeamMessage(input(graph(), "necesito algo para mi obra", { aiClassify: ai }));
    expect(calls).toBe(1);
    expect(r).toMatchObject({ finalNodeId: "ven", aiUsed: true });
    expect(r.hops[0].kind).toBe("ai");
    // un bot que no es de entrada ni recepcionista no clasifica con IA salvo conexiones "IA"
    await routeTeamMessage(input(graph(), "necesito algo para mi obra", { currentNodeId: "ven", aiClassify: ai }));
    expect(calls).toBe(1);
  });

  it("límite de derivaciones seguidas y racha previa", async () => {
    const g = graph({ settings: { entryNodeId: "rec", unknownIntent: "stay", maxConsecutiveTransfers: 2, fallback: "entry" } });
    const r = await routeTeamMessage(input(g, "precio", { streak: 2 }));
    expect(r).toMatchObject({ toHuman: true });
    expect(r.hops.at(-1)?.kind).toBe("loop_guard");
  });

  it("bucle en tiempo de ejecución (bot ya visitado) → persona", async () => {
    const g = graph({
      edges: [
        { id: "a", source: "rec", target: "ven", data: { condition: { kind: "keywords", keywords: ["zeta"] }, enabled: true } },
        { id: "b", source: "ven", target: "rec", data: { condition: { kind: "keywords", keywords: ["zeta"] }, enabled: true } },
      ],
    });
    const r = await routeTeamMessage(input(g, "zeta"));
    expect(r.toHuman).toBe(true);
    expect(r.hops.at(-1)?.reason).toMatch(/Bucle/);
  });

  it("destino no disponible → bot de entrada o persona según la regla", async () => {
    const g = graph();
    const unavailable = (id: string) => id !== "sop";
    const fromVen = await routeTeamMessage(input(g, "no funciona", { currentNodeId: "ven", isAvailable: unavailable }));
    expect(fromVen).toMatchObject({ finalNodeId: "rec", toHuman: false });
    expect(fromVen.hops[0].kind).toBe("unavailable");
    const human = await routeTeamMessage(input({ ...g, settings: { ...g.settings, fallback: "human" } }, "no funciona", { currentNodeId: "ven", isAvailable: unavailable }));
    expect(human.toHuman).toBe(true);
    // bot activo eliminado → vuelve a la entrada
    const gone = await routeTeamMessage(input(g, "gracias", { currentNodeId: "ven", isAvailable: (id) => id !== "ven" }));
    expect(gone.finalNodeId).toBe("rec");
  });

  it("necesidad no identificada: quedarse o pasar a persona", async () => {
    const g = graph({ settings: { entryNodeId: "rec", unknownIntent: "human", maxConsecutiveTransfers: 3, fallback: "entry" } });
    expect((await routeTeamMessage(input(g, "tengo una consulta rara"))).toHuman).toBe(true);
    expect((await routeTeamMessage(input(g, "hola"))).toHuman).toBe(false);
  });
});

describe("validación del equipo", () => {
  const ctx = (): TeamValidationContext => ({
    bots: new Map([
      ["b-rec", { id: "b-rec", name: "Recepción", role: "receptionist", published: true, allowedTools: ["classify"], pipelineIds: [], allowedStageIds: [], stageRefs: [] }],
      ["b-ven", { id: "b-ven", name: "Ventas", role: "sales", published: true, allowedTools: ["create_opportunity"], pipelineIds: [], allowedStageIds: [], stageRefs: [] }],
      ["b-sop", { id: "b-sop", name: "Soporte", role: "support", published: true, allowedTools: [], pipelineIds: [], allowedStageIds: [], stageRefs: [] }],
    ]),
    pipelines: new Set(["p1"]),
    stages: new Map([["s1", { pipelineId: "p1", kind: "open" }]]),
    defaultPipelineId: "p1",
  });
  it("equipo válido sin errores", () => {
    expect(validateTeamGraph(graph(), ctx()).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("detecta bucles, bots faltantes, sin publicar, pipelines eliminados y recepcionista con herramientas de venta", () => {
    const c = ctx();
    c.bots.set("b-rec", { ...c.bots.get("b-rec")!, allowedTools: ["create_opportunity"] });
    c.bots.set("b-sop", { ...c.bots.get("b-sop")!, published: false, pipelineIds: ["borrado"] });
    const g = graph();
    g.edges.push({ id: "loop", source: "sop", target: "ven", data: { condition: { kind: "intent", intents: ["soporte"] }, enabled: true } });
    g.nodes.push({ id: "x", type: "bot", position: { x: 0, y: 0 }, data: { botId: "no-existe" } });
    g.edges.push({ id: "empty", source: "rec", target: "x", data: { condition: { kind: "keywords", keywords: [] }, enabled: true } });
    const msgs = validateTeamGraph(g, c).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/Bucle de derivaciones para "soporte"/);
    expect(msgs).toMatch(/bot que ya no existe/);
    expect(msgs).toMatch(/no tiene una versión publicada/);
    expect(msgs).toMatch(/pipeline que fue eliminado/);
    expect(msgs).toMatch(/recepcionista/);
    expect(msgs).toMatch(/palabra clave/);
  });
});

describe("salida de IA: productos y cotización", () => {
  it("productos solo del catálogo provisto; cotización solo si está habilitada", () => {
    const raw = JSON.stringify({ reply: "ok", opportunity: { title: "Taladro", products: ["P1", "P9"] }, quote: true });
    const d = parseAiDecision(raw, ["create_opportunity"], [], { productRefs: ["P1"], quoteEnabled: true });
    expect(d.opportunity?.products).toEqual(["P1"]);
    expect(d.quote).toBe(true);
    expect(d.blocked.join()).toMatch(/fuera del catálogo/);
    expect(parseAiDecision(raw, ["create_opportunity"], [], { productRefs: ["P1"] }).quote).toBe(false);
  });
});
