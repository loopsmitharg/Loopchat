import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AiTool, FlowNode } from "@/lib/flow/types";
import { db } from "../db";
import { contacts, conversations, opportunities, pipelines, stages, type ConversationBotState, type LeadData } from "../db/schema";
import { pipelineScope } from "./pipeline-scope";
import { INSTRUCTIONS_VERSION, type PolicyInput } from "@/lib/instructions/build";
import { liveMandatoryRules, tenantHoursSummary } from "../services/ai-profile";
import type { Ctx } from "../authz/context";
import { searchKnowledge } from "../services/knowledge";
import { searchCatalog } from "../services/products";
import { activeLeadFields, applyCollectedLeadData } from "../services/lead-fields";
import { createOpportunity, updateOpportunity } from "../services/opportunities";
import { createTask } from "../services/tasks";
import { buildPrompt, historyToMessages, parseAiDecision, type PromptField, type PromptProduct } from "./ai-step";
import type { AiNodeResult } from "./interpreter";
import { buildCommercialMemory } from "./memory";
import { assignableMembers, effectiveTools, isAssignableMember, type BotSettings } from "./settings";

/**
 * Un turno de IA: arma el contexto permitido (instrucciones, estilo, conocimiento, catálogo,
 * memoria, datos a recopilar), llama al modelo y aplica SOLO las acciones autorizadas por la
 * configuración del bot. Lo usan el runtime (efectos reales) y el simulador (dryRun: describe
 * las acciones sin ejecutarlas).
 */
export type TurnAction = { kind: "executed" | "simulated" | "blocked" | "info"; text: string };
export type TurnLog = {
  aiCalled: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  knowledge: string[];
  products: { id: string; title: string; price: number | null; stock: number | null }[];
  tools: string[];
  blocked: string[];
  actions: TurnAction[];
  /** Huella de las instrucciones efectivas usadas (sin datos de la conversación). */
  instructions?: { version: string; hash: string };
};

export type ModelCall = (req: { system: string; messages: ReturnType<typeof historyToMessages>; maxTokens: number; temperature?: number | null }) => Promise<{ text: string; inputTokens?: number; outputTokens?: number } | { handoff: { reason: string; code: string } }>;

export type TurnEnv = {
  tenantId: string;
  settings: BotSettings;
  node: FlowNode<"ai">;
  message: string;
  history: { direction: "in" | "out"; content: string }[];
  contactName: string | null;
  /** null en simulación. */
  conversationId: string | null;
  contactId: string | null;
  dryRun: boolean;
  callModel: ModelCall;
  /** Contexto del bot para efectos reales (runtime). */
  ctx: Ctx;
  /** Aviso de horario para el prompt (fuera de horario con regla "avisar y continuar"). */
  outOfHoursNote?: string | null;
  /** Simulación: racha de consultas sin resolver y oportunidades ficticias por pipeline. */
  simState?: SimState;
  /** Resumen del traspaso interno (equipos de chatbots). */
  transferNote?: string | null;
  botName?: string;
  /** Equipo de la conversación (coordinación entre bots). */
  team?: PolicyInput["team"];
};

export type SimState = { unresolvedStreak: number; opps?: Record<string, { stageId: string; title: string; stageName: string; pipelineName: string }> };

export function emptyTurnLog(): TurnLog {
  return { aiCalled: false, inputTokens: 0, outputTokens: 0, latencyMs: 0, knowledge: [], products: [], tools: [], blocked: [], actions: [] };
}

export async function runAiTurn(env: TurnEnv): Promise<{ result: AiNodeResult; log: TurnLog }> {
  const log = emptyTurnLog();
  const { settings, tenantId } = env;
  const cfg = settings.config;
  const requested = [...new Set((env.node.data.tools ?? []) as AiTool[])];
  const tools = effectiveTools(settings, requested);
  for (const t of requested.filter((x) => !tools.includes(x) && x !== "handoff")) log.blocked.push(`${t}: no permitido para el rol o la configuración del pipeline`);

  const scope = await pipelineScope(tenantId, cfg, env.contactId, env.simState?.opps);
  const { opp, all: allStages, allowed: okStages } = scope;
  // mover etapa solo aplica con oportunidad abierta (o al crearla en la simulación)
  const hasSimOpp = Boolean(env.simState?.opps && Object.keys(env.simState.opps).some((p) => scope.pipelineIds.includes(p)));
  // (al crear una oportunidad también puede elegir la etapa inicial, dentro de las permitidas)
  const stageNames = opp || hasSimOpp || tools.includes("create_opportunity") ? okStages.map((s) => s.name) : [];

  const knowledge = tools.includes("use_knowledge") ? await searchKnowledge(tenantId, env.message, 4, cfg.knowledge.mode === "selected" ? cfg.knowledge.sourceIds : null) : [];
  log.knowledge = knowledge.map((k) => k.title);

  let catalog: { products: PromptProduct[]; overview: string[]; total: number; canSendPhotos: boolean } | null = null;
  let refMap = new Map<string, { id: string; title: string; hasPhoto: boolean }>();
  if (tools.includes("use_catalog")) {
    const res = await searchCatalog(tenantId, { productIds: cfg.catalog.mode === "all" ? null : settings.productIds }, env.message, 5);
    const prods = res.matches.map((m, i) => ({ ref: `P${i + 1}`, title: m.title, description: m.description, price: m.price, currency: m.currency, stock: m.stock, hasPhoto: m.hasPhoto }));
    refMap = new Map(res.matches.map((m, i) => [`P${i + 1}`, { id: m.id, title: m.title, hasPhoto: m.hasPhoto }]));
    catalog = { products: prods, overview: res.overview.map((o) => o.title), total: res.total, canSendPhotos: cfg.catalog.sendPhotos };
    log.products = res.matches.map((m) => ({ id: m.id, title: m.title, price: m.price, stock: m.stock }));
  }

  const memory = cfg.memory.enabled && env.contactId ? await buildCommercialMemory(tenantId, env.contactId, env.conversationId, scope.pipelineIds) : null;

  let fields: PromptField[] = [];
  if (tools.includes("collect_data") && cfg.objectives.fields.length) {
    const defs = await activeLeadFields(tenantId);
    const contact = env.contactId ? await db.query.contacts.findFirst({ where: and(eq(contacts.id, env.contactId), eq(contacts.tenantId, tenantId)) }) : null;
    const data = ((contact?.leadData ?? {}) as LeadData) ?? {};
    fields = cfg.objectives.fields.flatMap((f) => {
      const d = defs.find((x) => x.key === f.key);
      return d ? [{ key: d.key, label: d.label, type: d.type, options: d.options, required: f.required, current: data[d.key]?.value ?? null }] : [];
    });
  }

  // política de la empresa: la copiada en la versión (o la vigente en borradores) + reglas obligatorias en vivo
  const mandatoryRules = await liveMandatoryRules(tenantId);
  const hours = settings.company ? (await tenantHoursSummary(tenantId)).hours : null;
  const disabled = new Set(cfg.behavior.disabledCompanyRules);
  const built = buildPrompt({
    botInstructions: settings.instructions,
    nodeInstructions: env.node.data.instructions,
    tools,
    knowledge,
    stageNames,
    contactName: env.contactName,
    config: cfg,
    role: settings.role,
    botName: env.botName ?? "",
    company: settings.company ? { name: settings.company.name, profile: settings.company.profile, rules: settings.company.rules.filter((r) => !disabled.has(r.id)), hoursSummary: hours } : null,
    mandatoryRules,
    team: env.team ?? null,
    catalog,
    memory,
    fields,
    trackResolution: cfg.hours.maxUnresolvedAttempts > 0,
    outOfHoursNote: env.outOfHoursNote ?? null,
    opportunityPolicy: cfg.pipeline.createOpportunity === "any_inquiry" ? "any_inquiry" : "purchase_intent",
    quoteEnabled: Boolean(scope.quoteStage),
    transferNote: env.transferNote ?? null,
  });
  const system = built.system;
  log.instructions = { version: INSTRUCTIONS_VERSION, hash: built.hash };

  const t0 = Date.now();
  const out = await env.callModel({ system, messages: historyToMessages(env.history, env.message), maxTokens: cfg.operation.maxResponseTokens ?? 600, temperature: cfg.operation.temperature });
  log.latencyMs = Date.now() - t0;
  if ("handoff" in out) return { result: { handoff: out.handoff }, log };
  log.aiCalled = true;
  log.inputTokens = out.inputTokens ?? 0;
  log.outputTokens = out.outputTokens ?? 0;

  const decision = parseAiDecision(out.text, tools, stageNames, { productRefs: [...refMap.keys()], fieldKeys: fields.map((f) => f.key), allStageNames: allStages.map((s) => s.name), quoteEnabled: Boolean(scope.quoteStage) });
  log.blocked.push(...decision.blocked);
  for (const b of decision.blocked) log.actions.push({ kind: "blocked", text: `Acción bloqueada: ${b}` });
  if (decision.intent) log.tools.push("classify");
  if (knowledge.length) log.tools.push("use_knowledge");
  if (catalog) log.tools.push("use_catalog");

  const did = (kind: "executed" | "simulated", text: string) => log.actions.push({ kind, text });
  const mode = env.dryRun ? "simulated" : "executed";

  // falla de una acción: con la regla activada se deriva en lugar de reintentar todo el turno
  let toolFailure: AiNodeResult["handoff"] = null;
  async function guardTool<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    if (!cfg.behavior.handoffOnToolError) return fn();
    try {
      return await fn();
    } catch (e) {
      log.actions.push({ kind: "blocked", text: `No se pudo ejecutar la acción "${name}": ${(e as Error).message.slice(0, 120)}` });
      toolFailure = toolFailure ?? { reason: `Error al ejecutar la acción "${name}"`, code: "tool_error" };
      return null;
    }
  }

  // oportunidad (deduplicada: una abierta por contacto y pipeline) + cotización
  if (decision.quote && scope.quoteStage && !decision.opportunity?.stage) decision.opportunity = { ...(decision.opportunity ?? {}), stage: scope.quoteStage.name };
  if (decision.opportunity) {
    const stageName = decision.opportunity.stage ?? null;
    const stage = stageName ? (okStages.find((s) => s.name === stageName) ?? (decision.quote && scope.quoteStage?.name === stageName ? scope.quoteStage : null)) : null;
    const productIds = (decision.opportunity.products ?? []).map((r) => refMap.get(r)?.id).filter((x): x is string => Boolean(x));
    const creating = !opp && !(hasSimOpp && env.dryRun);
    if (creating && !tools.includes("create_opportunity")) {
      log.actions.push({ kind: "blocked", text: "Oportunidad no creada: el bot no puede crear oportunidades" });
    } else {
      const pipelineId = opp?.pipelineId ?? stage?.pipelineId ?? scope.primaryId;
      const targetStage = stage ?? (creating ? scope.initialStage : null);
      const label = `oportunidad${decision.opportunity.title ? ` "${decision.opportunity.title}"` : ""}${targetStage ? ` en etapa "${targetStage.name}"` : ""}${pipelineId ? ` (pipeline "${scope.pipelineNames[pipelineId] ?? ""}")` : ""}${decision.opportunity.amount ? ` por ${decision.opportunity.amount}` : ""}${productIds.length ? ` con ${productIds.length} producto(s)` : ""}`;
      if (env.dryRun) {
        did(mode, `${creating ? "Crearía" : "Actualizaría"} ${label}`);
        if (env.simState && pipelineId && targetStage) env.simState.opps = { ...(env.simState.opps ?? {}), [pipelineId]: { stageId: targetStage.id, title: decision.opportunity.title || env.simState.opps?.[pipelineId]?.title || "Consulta", stageName: targetStage.name, pipelineName: scope.pipelineNames[pipelineId] ?? "" } };
      } else if (env.conversationId && pipelineId) {
        const r = await guardTool("oportunidad", () => applyOpportunity(env.ctx, tenantId, env.conversationId!, { pipelineId, stageId: targetStage?.id ?? null, title: decision.opportunity!.title, amount: decision.opportunity!.amount ?? null, productIds, ownerUserId: cfg.pipeline.defaultOwnerUserId }, env.contactName));
        if (r) did(mode, `${r === "created" ? "Creó" : "Actualizó"} ${label}`);
      }
      log.tools.push(stage ? "update_stage" : "create_opportunity");
    }
  }

  // tarea con responsable y vencimiento según reglas del bot
  if (decision.task) {
    const hours = Math.min(decision.task.dueInHours ?? cfg.tools.taskDefaultDueHours, cfg.tools.taskMaxDueHours);
    let assignee: string | null = null;
    if (!env.dryRun && env.conversationId) {
      const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, env.conversationId), eq(conversations.tenantId, tenantId)) });
      const wanted = cfg.tools.taskAssignee === "conversation" ? (conv?.assigneeUserId ?? null) : cfg.tools.taskAssignee === "user" ? cfg.tools.taskAssigneeUserId : null;
      assignee = wanted && (await assignableMembers(tenantId, [wanted])).has(wanted) ? wanted : null;
      const o = scope.pipelineIds.length ? await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, conv?.contactId ?? ""), eq(opportunities.status, "open"), inArray(opportunities.pipelineId, scope.pipelineIds)) }) : null;
      await guardTool("tarea", () => createTask(env.ctx, { title: decision.task!.title, dueAt: new Date(Date.now() + hours * 3600_000), opportunityId: o?.id ?? null, contactId: conv?.contactId ?? null, assigneeUserId: assignee }));
    }
    did(mode, `${env.dryRun ? "Crearía" : "Creó"} tarea "${decision.task.title}" (vence en ${hours} h)`);
    log.tools.push("create_task");
  }

  // datos comerciales (solo campos habilitados y valores válidos)
  if (Object.keys(decision.collected).length) {
    if (env.dryRun) {
      for (const [k, v] of Object.entries(decision.collected)) did(mode, `Guardaría dato comercial ${k} = "${v}"`);
    } else if (env.contactId) {
      const r = await applyCollectedLeadData(tenantId, env.contactId, fields.map((f) => f.key), decision.collected);
      for (const a of r.applied) did(mode, `Guardó dato comercial ${a.key} = "${a.value}"`);
      for (const x of r.rejected) log.actions.push({ kind: "blocked", text: `Dato descartado: ${x.key} (${x.reason})` });
    }
    log.tools.push("collect_data");
  }

  // foto de producto (solo de los productos provistos en este turno)
  const attachments: { productId: string; title: string }[] = [];
  if (decision.photo) {
    const p = refMap.get(decision.photo);
    if (p && p.hasPhoto && cfg.catalog.sendPhotos) {
      attachments.push({ productId: p.id, title: p.title });
      if (env.dryRun) did(mode, `Enviaría la foto de "${p.title}"`);
    } else log.actions.push({ kind: "blocked", text: `Foto no enviada: ${p ? "el producto no tiene foto o el envío de fotos está desactivado" : "producto desconocido"}` });
  }

  // productos consultados → memoria comercial; racha de consultas sin resolver → derivación
  let handoff: AiNodeResult["handoff"] = decision.handoff ? { ...decision.handoff, code: "ai" } : toolFailure;
  // oportunidad de alto valor: derivación determinística (no depende de que la IA lo decida)
  const amount = decision.opportunity?.amount ?? null;
  if (!handoff && cfg.behavior.highValueAmount !== null && amount !== null && amount >= cfg.behavior.highValueAmount) {
    handoff = { reason: `Oportunidad de alto valor (${amount} ≥ ${cfg.behavior.highValueAmount})`, code: "high_value" };
    log.actions.push({ kind: env.dryRun ? "simulated" : "executed", text: `${env.dryRun ? "Derivaría" : "Derivó"} a un vendedor: oportunidad de alto valor` });
  }
  const max = cfg.hours.maxUnresolvedAttempts;
  if (env.dryRun && env.simState) {
    env.simState.unresolvedStreak = decision.resolved === false ? env.simState.unresolvedStreak + 1 : decision.resolved === true ? 0 : env.simState.unresolvedStreak;
    if (!handoff && max > 0 && env.simState.unresolvedStreak >= max) handoff = { reason: `${max} consulta(s) seguidas sin resolver`, code: "max_attempts" };
  } else if (!env.dryRun && env.conversationId) {
    const conv = await db.query.conversations.findFirst({ columns: { botState: true }, where: and(eq(conversations.id, env.conversationId), eq(conversations.tenantId, tenantId)) });
    const state = { ...((conv?.botState ?? {}) as ConversationBotState) };
    if (log.products.length) state.productIds = [...new Set([...log.products.map((p) => p.id), ...(state.productIds ?? [])])].slice(0, 20);
    if (decision.resolved === false) state.unresolvedStreak = (state.unresolvedStreak ?? 0) + 1;
    else if (decision.resolved === true) state.unresolvedStreak = 0;
    await db.update(conversations).set({ botState: state }).where(and(eq(conversations.id, env.conversationId), eq(conversations.tenantId, tenantId)));
    if (!handoff && max > 0 && (state.unresolvedStreak ?? 0) >= max) handoff = { reason: `${max} consulta(s) seguidas sin resolver`, code: "max_attempts" };
  }
  if (handoff) log.tools.push("handoff");

  return { result: { reply: decision.reply, intent: decision.intent, handoff, attachments }, log };
}

/**
 * Crea u actualiza la oportunidad abierta del contacto en el pipeline indicado (una por contacto
 * y pipeline). Un bloqueo transaccional por contacto+pipeline evita duplicados cuando llegan dos
 * mensajes a la vez o un reintento repite el turno.
 */
async function applyOpportunity(
  ctx: Ctx,
  tenantId: string,
  conversationId: string,
  data: { pipelineId?: string | null; stageId: string | null; title?: string; amount: number | null; productIds?: string[]; ownerUserId?: string | null },
  contactName: string | null,
): Promise<"created" | "updated" | null> {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)) });
  if (!conv) return null;
  let pipelineId = data.pipelineId ?? null;
  if (!pipelineId && data.stageId) pipelineId = (await db.query.stages.findFirst({ where: and(eq(stages.id, data.stageId), eq(stages.tenantId, tenantId)) }))?.pipelineId ?? null;
  if (!pipelineId) pipelineId = (await db.query.pipelines.findFirst({ where: and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true)) }))?.id ?? null;
  if (!pipelineId) return null;
  const pid = pipelineId;
  const owner = data.ownerUserId && (await isAssignableMember(tenantId, data.ownerUserId)) ? data.ownerUserId : null;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`opp:${conv.contactId}:${pid}`}))`);
    const open = await tx.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, conv.contactId), eq(opportunities.pipelineId, pid), eq(opportunities.status, "open")) });
    if (!open) {
      const created = await createOpportunity(
        ctx,
        { contactId: conv.contactId, conversationId: conv.id, title: data.title?.trim() || `Consulta de ${contactName ?? "contacto"}`, pipelineId: pid, stageId: data.stageId ?? undefined, amount: data.amount ?? undefined, source: "bot", ownerUserId: owner },
        tx,
      );
      if (data.productIds?.length) await tx.update(opportunities).set({ productIds: [...new Set(data.productIds)] }).where(eq(opportunities.id, created.id));
      return { kind: "created" as const, open: null };
    }
    return { kind: "existing" as const, open };
  });
  if (result.kind === "created") return "created";
  const open = result.open!;
  const patch: Record<string, unknown> = { expectedVersion: open.version };
  if (data.stageId && data.stageId !== open.stageId) patch.stageId = data.stageId;
  if (data.amount !== undefined && data.amount !== null) patch.amount = data.amount;
  if (data.title && data.title.trim() && open.title.startsWith("Consulta de")) patch.title = data.title.trim();
  const newProducts = (data.productIds ?? []).filter((p) => !open.productIds.includes(p));
  if (newProducts.length) await db.update(opportunities).set({ productIds: [...open.productIds, ...newProducts].slice(0, 30) }).where(eq(opportunities.id, open.id));
  if (Object.keys(patch).length > 1) {
    await updateOpportunity(ctx, open.id, patch as never);
    return "updated";
  }
  return newProducts.length ? "updated" : null;
}

export { applyOpportunity };
