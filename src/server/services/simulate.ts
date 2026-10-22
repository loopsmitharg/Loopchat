import "server-only";
import { and, eq } from "drizzle-orm";
import type { FlowGraph, FlowNode } from "@/lib/flow/types";
import { validateGraph } from "@/lib/flow/validate";
import { db } from "../db";
import { botVersions, bots, stages, tenants } from "../db/schema";
import { isWithinBusinessHours } from "@/lib/business-hours";
import { assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { runFlow, type FlowContext, type FlowEffects, type RunState } from "../flows/interpreter";
import { compileInstructionsBot } from "../flows/compile";
import { runAiTurn, type ModelCall, type SimState } from "../flows/ai-turn";
import { checkInsult, HANDOFF_LABELS, OUT_OF_HOURS_NOTE, type HandoffCode } from "../flows/policy";
import { draftSettings, settingsFromVersion, type BotSettings } from "../flows/settings";
import { resolvePersona } from "@/lib/instructions/persona";
import type { PolicyInput } from "@/lib/instructions/build";
import { loadProviderForTenant } from "./ai-connections";
import { completeAiCall, reserveAiCall } from "./usage";

export type SimEvent = { kind: "user" | "bot" | "action" | "blocked" | "system"; text: string };
export type SimTurnSummary = { message: string; aiCalled: boolean; tools: string[]; blocked: string[]; handoff: { code: string; label: string } | null; instructions?: { version: string; hash: string } };

/** IA simulada (sin proveedor): respuestas deterministas que usan los datos provistos en el prompt. */
function mockModel(): ModelCall {
  return async ({ system, messages }) => {
    const last = messages.at(-1)?.content ?? "";
    // la IA simulada muestra qué estilo recibió en las instrucciones (prueba de que los selectores llegan al modelo)
    const style = system.match(/PERSONALIDAD Y ESTILO[^\n]*:\n([^\n]+)/)?.[1] ?? "";
    const tags = [
      style.match(/Tratá al cliente de (vos|tú|usted)/)?.[1] ? `trato: ${style.match(/Tratá al cliente de (vos|tú|usted)/)![1]}` : null,
      /Muy formal|Formal y respetuoso/.test(style) ? "formal" : /Muy informal|Informal y amistoso|Tono informal/.test(style) ? "informal" : null,
      /No uses emojis/.test(style) ? "sin emojis" : null,
      /muy breves/.test(style) ? "muy breve" : null,
      /Orientate a cerrar la venta|avanzar hacia una compra/.test(style) ? "orientado a ventas" : /No ofrezcas productos/.test(style) ? "sin vender" : null,
    ].filter(Boolean);
    const sim = `(IA simulada${tags.length ? ` · ${tags.join(", ")}` : ""})`;
    const m = last.toLowerCase();
    const out: Record<string, unknown> = { resolved: true };
    if (/(humano|persona|asesor|operador)/.test(m)) {
      out.handoff = true;
      out.handoff_reason = "El cliente pidió hablar con una persona (simulación)";
      out.reply = "Te paso con una persona del equipo.";
    }
    out.intent = /(precio|cu[aá]nto|cuesta|valor|sale)/.test(m) ? "precio" : /(comprar|quiero|pedido|encargar)/.test(m) ? "compra" : /(reclamo|queja|problema)/.test(m) ? "reclamo" : "consulta";
    const prod = system.match(/^\[P1\] (.+?) — (Precio: [^—]+?) — (Stock: [^—\n]+)/m);
    if (!out.reply && prod) {
      const price = prod[2].includes("NO INFORMADO") ? "no tengo el precio cargado; si querés lo consulto con el equipo" : `el precio es ${prod[2].replace("Precio: ", "")}`;
      const stock = prod[3].includes("sin información") ? "" : prod[3].includes("SIN STOCK") ? " Por ahora no hay stock." : ` Hay ${prod[3].replace("Stock: ", "")}.`;
      out.reply = `${sim} Tenemos ${prod[1]}: ${price}.${stock}`;
      const p1 = system.split("\n").find((l) => l.startsWith("[P1]")) ?? "";
      if (/(foto|imagen|ver)/.test(m) && p1.includes("tiene foto")) out.photo = "P1";
    } else if (!out.reply && /CATÁLOGO/.test(system) && /(tienen|venden|hay|producto)/.test(m)) {
      out.reply = `${sim} No encuentro ese producto en el catálogo; si querés, una persona del equipo lo confirma.`;
      out.resolved = false;
    }
    if (/(ganad|cerr[aá] la venta|marc[aá] (la venta|como) )/.test(m)) out.stage = "Ganado";
    if (/(seguimiento|llam[aá]me|llamenme)/.test(m)) out.task = { title: "Llamar al cliente", due_in_hours: 24 };
    if (out.intent === "compra" && !out.handoff) out.opportunity = { title: last.slice(0, 60), amount: null };
    const qty = m.match(/\b(\d{1,5})\s*(unidades|u\.|bolsas|cajas|metros|litros)?\b/);
    if (qty && /- cantidad \(/.test(system)) out.collected = { cantidad: qty[1] };
    if (!out.reply) out.reply = `${sim} Respuesta para: "${last.slice(0, 80)}"`;
    return { text: JSON.stringify(out), inputTokens: 0, outputTokens: 0 };
  };
}

export type SimShared = {
  events: SimEvent[];
  history: { direction: "in" | "out"; content: string }[];
  handedOff: boolean;
  welcomed: boolean;
  oohNotified: boolean;
  simState: SimState;
  closed: boolean;
  horario: "abierto" | "cerrado";
  outOfHoursMessage: string | null;
  /** se llama cada vez que un bot "envía" un mensaje */
  onBotMessage?: () => void;
};

export function newShared(closed: boolean, outOfHoursMessage: string | null): SimShared {
  return { events: [], history: [], handedOff: false, welcomed: false, oohNotified: false, simState: { unresolvedStreak: 0, opps: {} }, closed, horario: closed ? "cerrado" : "abierto", outOfHoursMessage };
}

export function makeModelCall(ctx: Ctx, settings: BotSettings, useRealAi: boolean | undefined, keyPrefix: string): Promise<ModelCall> | ModelCall {
  if (!useRealAi) return mockModel();
  return (async () => {
    if (!settings.aiConnectionId) throw badRequest("El bot no tiene proveedor de IA.");
    const loaded = await loadProviderForTenant(ctx.tenantId, settings.aiConnectionId);
    if (!loaded) throw badRequest("Conexión de IA revocada.");
    const model = settings.model || loaded.row.defaultModel;
    const call: ModelCall = async (req) => {
      const reservation = await reserveAiCall(ctx.tenantId, `sim:${keyPrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, { provider: loaded.row.provider, model });
      if (!reservation.ok) return { handoff: { reason: "Cupo de IA agotado", code: "quota" } };
      try {
        const r = await loaded.provider.chat({ model, system: req.system, messages: req.messages, jsonMode: true, maxTokens: req.maxTokens, ...(req.temperature !== null && req.temperature !== undefined ? { temperature: req.temperature } : {}) });
        await completeAiCall(reservation.eventId, "success", { inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        return r;
      } catch (e) {
        await completeAiCall(reservation.eventId, "failure", { detail: (e as Error).message });
        return { handoff: { reason: `Falla del proveedor de IA: ${(e as Error).message}`, code: "error" } };
      }
    };
    return call;
  })();
}

export type TurnExtra = { inputTokens: number; outputTokens: number; actions: string[] };

/**
 * Sesión simulada de UN bot (mismo intérprete, mismas reglas previas y mismo armado de contexto
 * que el runtime; sin efectos reales). El simulador de equipos crea una por bot y comparte el
 * historial, el estado de derivación y las oportunidades simuladas.
 */
export class BotSim {
  state: RunState;
  waiting = false;
  turn: SimTurnSummary = { message: "", aiCalled: false, tools: [], blocked: [], handoff: null };
  extra: TurnExtra = { inputTokens: 0, outputTokens: 0, actions: [] };
  transferNote: string | null = null;
  botName = "";
  team: PolicyInput["team"] = null;
  private oohNote: string | null = null;

  constructor(
    private ctx: Ctx,
    public settings: BotSettings,
    private graph: FlowGraph,
    private callModel: ModelCall,
    private shared: SimShared,
    private useRealAi: boolean,
    private tenantStages: { id: string; name: string }[],
  ) {
    this.state = this.fresh();
  }

  private fresh(): RunState {
    return { currentNodeId: null, context: { lastMessage: "", vars: { horario: this.shared.horario }, contactName: "Cliente de prueba" }, stepCount: 0 };
  }

  reset() {
    this.state = this.fresh();
    this.waiting = false;
  }

  describeHandoff(code: HandoffCode, reason: string, sendTransfer: boolean) {
    const cfg = this.settings.config;
    const { events } = this.shared;
    this.shared.handedOff = true;
    this.turn.handoff = { code, label: HANDOFF_LABELS[code] ?? code };
    if (sendTransfer && cfg.handoff.transferMessage.trim()) events.push({ kind: "bot", text: cfg.handoff.transferMessage.trim() });
    events.push({ kind: "action", text: `Derivaría a una persona (${HANDOFF_LABELS[code] ?? code}): ${reason}` });
    events.push({ kind: "action", text: cfg.handoff.assignToUserId ? "Asignaría la conversación al responsable configurado (si no tiene uno)." : "La conversación quedaría sin responsable, marcada como \"Pide humano\"." });
    if (cfg.handoff.notifyTeam) events.push({ kind: "action", text: "Crearía una tarea para que el equipo atienda la conversación." });
  }

  /** Reglas previas (insulto). Devuelve true si la conversación pasó a una persona. */
  async insult(m: string) {
    const insult = await checkInsult(this.ctx.tenantId, this.settings.config, m);
    if (!insult.flagged) return false;
    this.shared.events.push({ kind: "system", text: `Insulto detectado (${insult.matches.map((x) => `${x.lang}: "${x.term}"`).join(", ")}). La IA NO se llama: no consume tokens.` });
    this.describeHandoff("insult_detection", "Insulto o agresión verbal detectada", true);
    return true;
  }

  async step(m: string, i: number, opts: { skipInsult?: boolean } = {}) {
    const cfg = this.settings.config;
    const { events } = this.shared;
    if (!opts.skipInsult && (await this.insult(m))) return;
    if (!this.waiting) {
      if (this.shared.closed && cfg.hours.outOfHours !== "respond") {
        if (!this.shared.oohNotified) {
          events.push({ kind: "bot", text: (cfg.hours.outOfHoursMessage || this.shared.outOfHoursMessage || "Estamos fuera de nuestro horario de atención. Te respondemos apenas volvamos.").trim() });
          this.shared.oohNotified = true;
        }
        if (cfg.hours.outOfHours === "message_and_handoff") {
          this.describeHandoff("out_of_hours", "Mensaje fuera del horario de atención", false);
          return;
        }
        this.oohNote = OUT_OF_HOURS_NOTE;
      }
      if (cfg.personality.welcomeMessage.trim() && !this.shared.welcomed) {
        events.push({ kind: "bot", text: cfg.personality.welcomeMessage.trim() });
        this.shared.welcomed = true;
      }
    }
    const res = await runFlow(this.graph, this.state, this.effects(), { mode: this.waiting ? "reply" : "start", message: m, runKey: `sim:${i}` });
    this.state = res.state;
    this.waiting = res.outcome.status === "waiting";
    if (this.waiting) events.push({ kind: "system", text: "El bot espera la respuesta del cliente." });
    if (res.outcome.status === "completed") this.state = this.fresh();
    if (res.outcome.status === "failed") events.push({ kind: "system", text: `Error: ${res.outcome.reason}` });
  }

  private effects(): FlowEffects {
    const { events, history } = this.shared;
    return {
      now: () => new Date(),
      stillInControl: async () => !this.shared.handedOff,
      sendMessage: async (text) => {
        events.push({ kind: "bot", text });
        history.push({ direction: "out", content: text });
        this.shared.onBotMessage?.();
      },
      sendAttachment: async (a) => {
        events.push({ kind: "action", text: `Enviaría la foto de "${a.title}"` });
      },
      ai: async (node: FlowNode<"ai">, fctx: FlowContext) => {
        const { result, log } = await runAiTurn({ tenantId: this.ctx.tenantId, settings: this.settings, node, message: fctx.lastMessage, history, contactName: "Cliente de prueba", conversationId: null, contactId: null, dryRun: true, callModel: this.callModel, ctx: this.ctx, simState: this.shared.simState, outOfHoursNote: this.oohNote, transferNote: this.transferNote, botName: this.botName, team: this.team });
        if (log.instructions) this.turn.instructions = log.instructions;
        this.turn.aiCalled = this.turn.aiCalled || log.aiCalled;
        this.turn.tools = [...new Set([...this.turn.tools, ...log.tools])];
        this.turn.blocked = [...this.turn.blocked, ...log.blocked];
        this.extra.inputTokens += log.inputTokens;
        this.extra.outputTokens += log.outputTokens;
        events.push({ kind: "system", text: log.aiCalled ? (this.useRealAi ? `IA real llamada (${log.inputTokens + log.outputTokens} tokens, ${log.latencyMs} ms)` : "IA simulada (sin llamar al proveedor)") : "La IA no se llamó" });
        if (log.knowledge.length) events.push({ kind: "system", text: `Conocimiento usado: ${log.knowledge.join(", ")}` });
        if (log.products.length) events.push({ kind: "system", text: `Productos consultados: ${log.products.map((p) => `${p.title} (precio: ${p.price === null ? "no informado" : p.price}; stock: ${p.stock === null ? "sin especificar" : p.stock})`).join(" · ")}` });
        for (const a of log.actions) {
          events.push({ kind: a.kind === "blocked" ? "blocked" : "action", text: a.text });
          this.extra.actions.push(a.text);
        }
        return result;
      },
      opportunity: async (data) => {
        const st = data.stageId ? this.tenantStages.find((s) => s.id === data.stageId)?.name : null;
        events.push({ kind: "action", text: `Crearía/actualizaría oportunidad${st ? ` en etapa "${st}"` : ""}${data.amount ? ` por ${data.amount}` : ""}` });
      },
      handoff: async (reason, meta) => {
        const code = (meta?.code || "flow") as HandoffCode;
        this.describeHandoff(code, reason, !(code === "ai" && meta?.aiReplied));
      },
      checkpoint: async () => {},
    };
  }
}

/**
 * Simulador: ejecuta el borrador del bot con el MISMO intérprete, las mismas reglas previas
 * (insultos, horario, bienvenida) y el mismo armado de contexto que el runtime, pero sin enviar
 * WhatsApp ni modificar el CRM: las acciones se describen como "haría…".
 * Por defecto la IA se simula; `useRealAi` llama al proveedor real (consume cupo).
 */
export async function simulateBot(ctx: Ctx, botId: string, input: { messages: string[]; useRealAi?: boolean; graph?: unknown; outOfHours?: boolean; versionId?: string | null }) {
  assertCan(ctx, "bot:write");
  const bot = await db.query.bots.findFirst({ where: and(eq(bots.id, botId), eq(bots.tenantId, ctx.tenantId)) });
  if (!bot) throw notFound();
  const msgs = input.messages.map((m) => String(m).slice(0, 1000)).filter((m) => m.trim()).slice(0, 10);
  if (msgs.length === 0) throw badRequest("Escribí al menos un mensaje de prueba.");
  // borrador (por defecto) o una versión publicada concreta (para comparar)
  let settings: BotSettings;
  let graph: FlowGraph;
  let label = "Borrador";
  if (input.versionId) {
    const v = await db.query.botVersions.findFirst({ where: and(eq(botVersions.id, input.versionId), eq(botVersions.botId, botId), eq(botVersions.tenantId, ctx.tenantId)) });
    if (!v) throw notFound("Versión inexistente.");
    settings = settingsFromVersion(bot, v.settings);
    graph = v.graph as FlowGraph;
    label = `v${v.version}`;
  } else {
    settings = await draftSettings(bot);
    graph = (bot.mode === "instructions" ? compileInstructionsBot({ tools: settings.allowedTools, handoffKeywords: settings.handoffKeywords }) : (input.graph ?? bot.draftGraph)) as FlowGraph;
  }
  const tenantStages = await db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.tenantId, ctx.tenantId));
  const issues = validateGraph(graph, { stageIds: new Set(tenantStages.map((s) => s.id)) });
  if (issues.length) return { ok: false as const, issues, events: [] as SimEvent[], turns: [] as SimTurnSummary[] };

  const callModel = await makeModelCall(ctx, settings, input.useRealAi, botId);
  const tenantRow = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  const closed = input.outOfHours ?? !isWithinBusinessHours(tenantRow?.settings?.businessHours, tenantRow?.timezone ?? "America/Argentina/Buenos_Aires");
  const shared = newShared(closed, tenantRow?.settings?.outOfHoursMessage ?? null);
  const sim = new BotSim(ctx, settings, graph, callModel, shared, Boolean(input.useRealAi), tenantStages);
  sim.botName = bot.name;
  const turns: SimTurnSummary[] = [];
  for (const [i, m] of msgs.entries()) {
    sim.turn = { message: m, aiCalled: false, tools: [], blocked: [], handoff: null };
    turns.push(sim.turn);
    shared.events.push({ kind: "user", text: m });
    shared.history.push({ direction: "in", content: m });
    if (shared.handedOff) {
      shared.events.push({ kind: "system", text: "La conversación está con un humano: el bot no responde." });
      continue;
    }
    await sim.step(m, i);
  }
  // configuración activa (para mostrar qué se probó)
  const persona = resolvePersona(settings.config.personality, settings.role, settings.company?.profile.brand ?? null);
  return {
    ok: true as const,
    issues: [],
    events: shared.events,
    turns,
    outOfHours: closed,
    config: { label, role: settings.role, persona: persona.lines, notes: persona.notes, instructions: turns.find((t) => t.instructions)?.instructions ?? null },
  };
}
