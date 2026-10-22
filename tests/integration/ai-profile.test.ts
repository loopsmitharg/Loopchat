import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { conversationActivity, flowRuns, usageEvents } from "@/server/db/schema";
import { createAiConnection } from "@/server/services/ai-connections";
import { addSuggestedRules, createRule, getAiProfile, updateAiProfile, updateRule } from "@/server/services/ai-profile";
import { createBot, getBot, publishBot, republishOutdatedBots, restoreVersion, setBotStatus, updateBotSettings } from "@/server/services/bots";
import { compareVersions, getEffectiveInstructions } from "@/server/services/bot-instructions";
import { addTextSource } from "@/server/services/knowledge";
import { simulateBot } from "@/server/services/simulate";
import type { Ctx } from "@/server/authz/context";
import { addMember, ctxFor, twoTenants } from "../helpers/factory";
import { aiSim, localConversation, provisionWithChannel, settle, simIncoming, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});
beforeEach(async () => {
  await aiSim.reset();
});

let seq = 0;
const phone = () => `+54911900${String(Date.now()).slice(-4)}${String(seq++).padStart(2, "0")}`;

async function liveBot(ctx: Ctx, extra: Parameters<typeof createBot>[1] = { name: "Asistente" }) {
  const conn = await createAiConnection(ctx, { provider: "openai_compatible", label: "Principal", apiKey: "sk-tenant-key-AAAA", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
  const bot = await createBot(ctx, { aiConnectionId: conn.id, instructions: "Vendemos herramientas.", allowedTools: ["classify", "use_knowledge", "handoff", "create_opportunity"], handoffKeywords: [], ...extra });
  await publishBot(ctx, bot.id);
  await setBotStatus(ctx, bot.id, "active");
  return { bot, conn };
}

describe("identidad, objetivos y reglas de la empresa", () => {
  it("objetivo, personalidad de marca y reglas persisten, por empresa y con permisos", async () => {
    const { A, ctxA, ctxB, ctxAgentA } = await twoTenants();
    const manager = await addMember(A.id, "manager", "Mara Manager");
    const ctxManager = ctxFor(A.id, manager, "manager");
    const saved = await updateAiProfile(ctxA, { objectives: { primary: "increase_sales", secondary: ["qualify_leads"], statement: "Convertir consultas en oportunidades calificadas." }, brand: { formality: "professional_warm", address: "vos" }, identity: { description: "Ferretería de barrio" } });
    expect(saved.profile.objectives.primary).toBe("increase_sales");
    expect(saved.revision).toBe(1);
    expect((await getAiProfile(ctxB)).profile.objectives.primary).toBeNull(); // otra empresa no ve nada
    await expect(updateAiProfile(ctxAgentA, {})).rejects.toThrow();
    // reglas: un manager crea reglas comunes, pero no obligatorias
    const r = await createRule(ctxManager, { text: "No prometer plazos de entrega no confirmados.", category: "delivery" });
    await expect(createRule(ctxManager, { text: "No ofrecer descuentos sin autorización.", category: "discounts", mandatory: true })).rejects.toThrow(/administrador/);
    await expect(updateRule(ctxManager, r.id, { mandatory: true })).rejects.toThrow(/administrador/);
    const added = await addSuggestedRules(ctxA);
    expect(added.added).toBe(9);
    expect((await addSuggestedRules(ctxA)).added).toBe(0);
    const p = await getAiProfile(ctxA);
    expect(p.rules.filter((x) => x.mandatory)).toHaveLength(5);
    expect((await getAiProfile(ctxB)).rules).toHaveLength(0);
  });

  it("herencia: obligatorias en vivo; el resto al publicar; un bot no puede desactivar una obligatoria", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await liveBot(ctxA);
    // bot publicado ANTES de la política: no cambia de golpe…
    const mandatory = await createRule(ctxA, { text: "No confirmar pagos sin verificación.", category: "payments", mandatory: true });
    const common = await createRule(ctxA, { text: "No insistir cuando el cliente rechaza una oferta.", category: "sales_conduct" });
    await updateAiProfile(ctxA, { objectives: { primary: "increase_sales" } });
    const r1 = await simIncoming(accountId, { phone: phone(), content: "hola" });
    await settle();
    let sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toContain("No confirmar pagos sin verificación."); // …salvo las obligatorias, que rigen al instante
    expect(sys).not.toContain("No insistir cuando el cliente rechaza");
    expect(sys).not.toContain("Objetivo principal del equipo de IA");
    // la empresa ve qué bots tienen la política desactualizada
    expect((await getAiProfile(ctxA)).bots.find((b) => b.id === bot.id)?.outdated).toBe(true);
    expect((await getBot(ctxA, bot.id)).unpublishedChanges).toBe(true);
    // un bot no puede desactivar la obligatoria; sí una común
    await expect(updateBotSettings(ctxA, bot.id, { config: { behavior: { disabledCompanyRules: [mandatory.id] } } })).rejects.toThrow(/obligatorias/);
    const res = await republishOutdatedBots(ctxA);
    expect(res.published).toContain("Asistente");
    await aiSim.reset();
    await simIncoming(accountId, { phone: phone(), content: "hola de nuevo" });
    await settle();
    sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toContain("No insistir cuando el cliente rechaza una oferta.");
    expect(sys).toContain("Objetivo principal del equipo de IA: Aumentar las ventas.");
    await updateBotSettings(ctxA, bot.id, { config: { behavior: { disabledCompanyRules: [common.id] } } });
    await publishBot(ctxA, bot.id);
    await aiSim.reset();
    await simIncoming(accountId, { phone: phone(), content: "otra consulta" });
    await settle();
    sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).not.toContain("No insistir cuando el cliente rechaza");
    expect(sys).toContain("No confirmar pagos sin verificación.");
    // las reglas de la empresa no anulan la seguridad: las reglas de plataforma van primero
    expect(sys.indexOf("Reglas que siempre se cumplen")).toBeLessThan(sys.indexOf("REGLAS OBLIGATORIAS"));
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, (await localConversation(A.id, r1.conversationId))!.id) });
    expect(run?.metrics).toMatchObject({ instructions: { version: expect.any(String), hash: expect.any(String) } });
  });

  it("cada bot tiene su personalidad y objetivos, y llegan al modelo", async () => {
    const { ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await liveBot(ctxA, {
      name: "Vendedor",
      role: "sales",
      config: { personality: { formality: "very_formal", attitudes: ["persuasive"], salesIntensity: "sales", emojis: "none" }, identity: { goals: ["qualify"], showName: true, displayName: "Sofía" }, behavior: { dont: ["No aplicar descuentos sin autorización."] } },
    });
    await simIncoming(accountId, { phone: phone(), content: "hola" });
    await settle();
    const sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toContain("Muy formal");
    expect(sys).toContain("Tratá al cliente de usted.");
    expect(sys).toContain("Te llamás Sofía");
    expect(sys).toContain("calificar al interesado");
    expect(sys).toContain("No aplicar descuentos sin autorización.");
    expect(sys).toContain("Si el cliente rechaza una propuesta");
    // otro bot, otra personalidad (borrador): el simulador usa el mismo motor
    const other = await createBot(ctxA, { name: "Soporte", role: "support", config: { personality: { formality: "informal", address: "vos", attitudes: ["persuasive", "empathetic"] } } });
    const ins = await getEffectiveInstructions(ctxA, other.id, "draft");
    expect(ins.system).toContain("Informal y amistoso.");
    expect(ins.system).not.toContain("persuasivo sin presionar");
    expect(ins.notes.map((n) => n.field)).toContain("attitudes");
    expect(ins.system).not.toContain("sk-tenant-key");
    const sim = await simulateBot(ctxA, bot.id, { messages: ["hola"] });
    expect(sim.ok && sim.events.some((e) => e.kind === "bot" && /trato: usted/.test(e.text))).toBe(true);
  });

  it("vista de instrucciones efectivas y comparación/restauración de versiones", async () => {
    const { ctxA } = await twoTenants();
    await createRule(ctxA, { text: "No ofrecer descuentos sin autorización.", category: "discounts", mandatory: true });
    const { bot } = await liveBot(ctxA);
    await updateBotSettings(ctxA, bot.id, { config: { personality: { formality: "very_informal" } } });
    const draft = await getEffectiveInstructions(ctxA, bot.id, "draft");
    const pub = await getEffectiveInstructions(ctxA, bot.id, "published");
    expect(draft.sections[0].key).toBe("platform");
    expect(draft.sections.map((s) => s.key)).toContain("mandatory");
    expect(draft.system).toContain("Muy informal");
    expect(pub.system).not.toContain("Muy informal");
    expect(draft.rules.find((r) => r.mandatory)?.applied).toBe(true);
    const cmp = await compareVersions(ctxA, bot.id, "published", "draft");
    expect(cmp.changes.map((c) => c.path)).toContain("config.personality.formality");
    const v2 = await publishBot(ctxA, bot.id);
    expect(v2.version).toBe(2);
    const v1 = (await getBot(ctxA, bot.id)).versions.at(-1)!;
    await restoreVersion(ctxA, bot.id, v1.id);
    expect((await getBot(ctxA, bot.id)).bot.config.personality.formality).toBeNull();
    // comparar la respuesta de dos versiones en el simulador
    const a = await simulateBot(ctxA, bot.id, { messages: ["hola"], versionId: v2.versionId });
    const b = await simulateBot(ctxA, bot.id, { messages: ["hola"], versionId: v1.id });
    expect(a.ok && a.config.label).toBe("v2");
    expect(b.ok && b.config.label).toBe("v1");
    expect(a.ok && a.events.some((e) => /informal/.test(e.text))).toBe(true);
  });

  it("derivaciones determinísticas: alto valor y límite de uso de IA, sin llamar a la IA de más", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await liveBot(ctxA, { name: "Ventas", config: { behavior: { highValueAmount: 50000 }, operation: { maxAiCallsPerConversation: 1 } } });
    const r = await simIncoming(accountId, { phone: phone(), content: "precio del taladro?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    const act = await db.query.conversationActivity.findFirst({ where: and(eq(conversationActivity.conversationId, conv.id), eq(conversationActivity.kind, "handoff")) });
    expect(act?.data).toMatchObject({ code: "high_value" });
    // límite: la segunda conversación llega a 1 llamada y la siguiente deriva sin IA
    const p = phone();
    const r2 = await simIncoming(accountId, { phone: p, content: "hola" });
    await settle();
    const before = (await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, A.id), eq(usageEvents.metric, "ai_calls")))).length;
    await simIncoming(accountId, { phone: p, content: "otra pregunta" });
    await settle();
    const after = (await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, A.id), eq(usageEvents.metric, "ai_calls")))).length;
    expect(after).toBe(before);
    const conv2 = (await localConversation(A.id, r2.conversationId))!;
    expect(conv2.attentionMode).toBe("requested");
  });

  it("conocimiento restringido: el bot solo usa las fuentes autorizadas", async () => {
    const { ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const ok = await addTextSource(ctxA, { title: "Envíos", content: "Hacemos envíos a domicilio en toda la zona norte." });
    await addTextSource(ctxA, { title: "Interno", content: "Envíos: margen interno confidencial del 40 por ciento." });
    await liveBot(ctxA, { name: "Bot", config: { knowledge: { mode: "selected", sourceIds: [ok.id] } } });
    await simIncoming(accountId, { phone: phone(), content: "hacen envíos?" });
    await settle();
    const sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toContain("zona norte");
    expect(sys).not.toContain("confidencial");
  });
});
