import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { contacts, conversationActivity, conversations, flowRuns, opportunities, stages, tasks, usageEvents } from "@/server/db/schema";
import { createAiConnection } from "@/server/services/ai-connections";
import { createBot, getBot, publishBot, restoreVersion, setBotStatus, updateBotSettings } from "@/server/services/bots";
import { setAttentionMode, setConversationStatus } from "@/server/services/conversations";
import { sendOutbound } from "@/server/services/outbound";
import { archiveProduct, createProduct, listProducts, readProductPhoto, setBotProducts, updateProduct, uploadProductPhoto } from "@/server/services/products";
import { createLeadField, contactLeadSummary, setContactLeadValue } from "@/server/services/lead-fields";
import { simulateBot } from "@/server/services/simulate";
import type { Ctx } from "@/server/authz/context";
import { twoTenants } from "../helpers/factory";
import { aiSim, localConversation, provisionWithChannel, settle, simIncoming, simMessages, startWebhookRelay } from "../helpers/chatwoot";

beforeAll(async () => {
  await startWebhookRelay();
});
beforeEach(async () => {
  await aiSim.reset();
});

async function setup(ctx: Ctx, config?: Parameters<typeof updateBotSettings>[2]["config"]) {
  const conn = await createAiConnection(ctx, { provider: "openai_compatible", label: "Principal", apiKey: "sk-tenant-key-AAAA", baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
  const bot = await createBot(ctx, { name: "Asistente", mode: "instructions", aiConnectionId: conn.id, instructions: "Vendemos herramientas.", allowedTools: ["classify", "use_knowledge", "handoff", "create_opportunity", "update_stage", "create_task"], handoffKeywords: ["asesor"] });
  if (config) await updateBotSettings(ctx, bot.id, { config });
  await publishBot(ctx, bot.id);
  await setBotStatus(ctx, bot.id, "active");
  return { conn, bot };
}
const outgoing = async (accountId: number, cw: number) => (await simMessages(accountId, cw)).filter((m) => m.message_type === 1).map((m) => m.content);
const aiCallsFor = async (tenantId: string) => (await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, tenantId), eq(usageEvents.metric, "ai_calls")))).length;

describe("derivación automática por insultos (sin IA)", () => {
  it("insulto → mensaje fijo, pide humano, responsable, tarea y motivo insult_detection; NO llama a la IA", async () => {
    const { A, ctxA, agentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA, { handoff: { transferMessage: "Voy a derivar tu conversación a una persona de nuestro equipo.", assignToUserId: agentA.id, notifyTeam: true } });
    const r = await simIncoming(accountId, { phone: "+5491170000001", name: "Cliente Enojado", content: "sos un p3l0tud0, respondé" });
    await settle();
    expect(await aiSim.requests()).toHaveLength(0);
    expect(await aiCallsFor(A.id)).toBe(0);
    expect(await outgoing(accountId, r.conversationId)).toEqual(["Voy a derivar tu conversación a una persona de nuestro equipo."]);
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    expect(conv.assigneeUserId).toBe(agentA.id);
    const act = await db.query.conversationActivity.findFirst({ where: and(eq(conversationActivity.conversationId, conv.id), eq(conversationActivity.kind, "handoff")) });
    expect(act?.data).toMatchObject({ code: "insult_detection", botId: bot.id });
    const task = await db.query.tasks.findFirst({ where: and(eq(tasks.tenantId, A.id), eq(tasks.contactId, conv.contactId)) });
    expect(task).toMatchObject({ assigneeUserId: agentA.id, createdByKind: "bot" });
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect(run?.status).toBe("handed_off");
    expect(run?.metrics).toMatchObject({ aiCalls: 0, handoffCode: "insult_detection" });
    // mensajes siguientes: el bot no interfiere con el vendedor
    await simIncoming(accountId, { phone: "+5491170000001", content: "hola? cuál es el precio del taladro?" });
    await settle();
    expect(await outgoing(accountId, r.conversationId)).toHaveLength(1);
    expect(await aiSim.requests()).toHaveLength(0);
  });

  it("frases ambiguas no derivan; con la detección desactivada el mensaje va a la IA", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491170000002", content: "¿Tienen burro de arranque y bolsas de basura? Mi pedido está retrasado" });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("bot");
    expect(await aiSim.requests()).toHaveLength(1);

    await updateBotSettings(ctxA, bot.id, { config: { handoff: { insultDetection: false } } });
    await publishBot(ctxA, bot.id);
    await aiSim.reset();
    const r2 = await simIncoming(accountId, { phone: "+5491170000003", content: "sos un pelotudo" });
    await settle();
    expect(await aiSim.requests()).toHaveLength(1);
    expect((await localConversation(A.id, r2.conversationId))!.attentionMode).toBe("bot");
  });

  it("guardar la configuración no cambia lo publicado hasta publicar; restaurar recupera una versión", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    await updateBotSettings(ctxA, bot.id, { config: { handoff: { insultDetection: false } }, instructions: "Otro texto" });
    const d = await getBot(ctxA, bot.id);
    expect(d.unpublishedChanges).toBe(true);
    // lo publicado sigue con detección activa
    const r = await simIncoming(accountId, { phone: "+5491170000004", content: "andate a la mierda" });
    await settle();
    expect(await aiSim.requests()).toHaveLength(0);
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("requested");
    // restaurar v1 → el borrador vuelve a la configuración de v1
    const v1 = d.versions.at(-1)!;
    await restoreVersion(ctxA, bot.id, v1.id);
    const after = await getBot(ctxA, bot.id);
    expect(after.bot.config.handoff.insultDetection).toBe(true);
    expect(after.bot.instructions).toBe("Vendemos herramientas.");
    expect(after.unpublishedChanges).toBe(false);
  });
});

describe("control de intervención humana", () => {
  it("vendedor toma la conversación pedida: pasa a humano; el bot no responde hasta reactivar; regla 'al resolver' reactiva", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA, { control: { autoResume: "on_resolve" } });
    const r = await simIncoming(accountId, { phone: "+5491170000005", content: "Quiero hablar con un humano" });
    await settle();
    let conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    await sendOutbound(ctxAgentA, { conversationId: conv.id, text: "Hola, soy Andrés", idempotencyKey: `manual:${conv.id}:1` });
    conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("human");
    await aiSim.reset();
    await simIncoming(accountId, { phone: "+5491170000005", content: "precio?" });
    await settle();
    expect(await aiSim.requests()).toHaveLength(0);
    await setConversationStatus(ctxAgentA, conv.id, "resolved");
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("bot");
  });

  it("sin regla explícita, resolver NO reactiva el bot; reactivar manualmente sí", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491170000006", content: "Quiero hablar con un humano" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    await setConversationStatus(ctxAgentA, conv.id, "resolved");
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("requested");
    await setAttentionMode(ctxAgentA, conv.id, { mode: "bot" });
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("bot");
  });
});

describe("reglas de herramientas validadas en el backend", () => {
  it("la IA no puede mover a una etapa no autorizada ni a 'ganada'; las tareas respetan responsable y vencimiento máximo", async () => {
    const { A, ctxA, agentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const st = await db.select().from(stages).where(eq(stages.tenantId, A.id));
    const nuevo = st.find((s) => s.kind === "open" && s.name !== "Cotizado")!;
    await setup(ctxA, { tools: { allowedStageIds: [nuevo.id], taskAssignee: "user", taskAssigneeUserId: agentA.id, taskDefaultDueHours: 4, taskMaxDueHours: 8 } });
    // el simulador de IA propone la etapa "Cotizado" (no autorizada)
    const r = await simIncoming(accountId, { phone: "+5491170000007", content: "precio del taladro?" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.tenantId, A.id), eq(opportunities.contactId, conv.contactId)) });
    expect(opp).toBeTruthy();
    expect(st.find((s) => s.id === opp!.stageId)!.name).not.toBe("Cotizado");
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect((run!.metrics as { blocked: string[] }).blocked.join(" ")).toMatch(/update_stage/);
    // tarea: el simulador pide 24 h → se limita a 8 h y se asigna a la persona configurada
    await simIncoming(accountId, { phone: "+5491170000007", content: "hacé el seguimiento" });
    await settle();
    const t = await db.query.tasks.findFirst({ where: and(eq(tasks.tenantId, A.id), eq(tasks.contactId, conv.contactId), eq(tasks.createdByKind, "bot")) });
    expect(t?.assigneeUserId).toBe(agentA.id);
    expect(t!.dueAt!.getTime() - Date.now()).toBeLessThanOrEqual(8 * 3600_000 + 5000);
  });

  it("no se puede configurar una etapa de cierre ni un responsable de otra empresa", async () => {
    const { A, ctxA, adminB } = await twoTenants();
    const { bot } = await setup(ctxA);
    const won = (await db.select().from(stages).where(eq(stages.tenantId, A.id))).find((s) => s.kind === "won")!;
    await expect(updateBotSettings(ctxA, bot.id, { config: { tools: { allowedStageIds: [won.id] } } })).rejects.toThrow(/cierre/);
    await expect(updateBotSettings(ctxA, bot.id, { config: { handoff: { assignToUserId: adminB.id } } })).rejects.toThrow(/miembro activo/);
    void contacts;
  });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("catálogo de productos", () => {
  it("título y descripción obligatorios; precio, stock y foto opcionales; stock vacío ≠ 0; aislamiento por empresa", async () => {
    const { ctxA, ctxB, ctxAgentA } = await twoTenants();
    await expect(createProduct(ctxA, { title: "", description: "x" })).rejects.toThrow();
    await expect(createProduct(ctxA, { title: "Taladro", description: "  " })).rejects.toThrow();
    await expect(createProduct(ctxA, { title: "Taladro", description: "x", price: -1 })).rejects.toThrow();
    await expect(createProduct(ctxA, { title: "Taladro", description: "x", stock: 1.5 })).rejects.toThrow();
    await expect(createProduct(ctxAgentA, { title: "Taladro", description: "x" })).rejects.toThrow(/permiso/);
    const sinDatos = await createProduct(ctxA, { title: "Amoladora angular", description: "115 mm, 820 W" });
    expect(sinDatos).toMatchObject({ price: null, stock: null, availability: "unknown", hasPhoto: false });
    const cero = await createProduct(ctxA, { title: "Taladro percutor", description: "13 mm, 750 W", price: "85000", stock: 0 });
    expect(cero).toMatchObject({ price: 85000, stock: 0, availability: "out_of_stock" });
    expect((await listProducts(ctxA, { availability: "unknown" })).map((p) => p.id)).toEqual([sinDatos.id]);
    expect((await listProducts(ctxA, { availability: "out_of_stock" })).map((p) => p.id)).toEqual([cero.id]);
    expect((await listProducts(ctxA, { q: "percutor" })).map((p) => p.id)).toEqual([cero.id]);
    // B no ve ni edita productos de A
    expect(await listProducts(ctxB)).toHaveLength(0);
    await expect(updateProduct(ctxB, cero.id, { price: 1 })).rejects.toThrow(/inexistente/);
    await expect(readProductPhoto(ctxB, cero.id)).rejects.toThrow();
    // stock: borrar (null) vuelve a "sin especificar"
    expect((await updateProduct(ctxA, cero.id, { stock: null })).availability).toBe("unknown");
  });

  it("fotos: valida el tipo real, reemplaza y controla el acceso", async () => {
    const { ctxA, ctxB } = await twoTenants();
    const p = await createProduct(ctxA, { title: "Taladro", description: "13 mm" });
    await expect(uploadProductPhoto(ctxA, p.id, Buffer.from("GIF89a....."))).rejects.toThrow(/Formato no admitido/);
    await expect(uploadProductPhoto(ctxA, p.id, Buffer.from("<script>alert(1)</script>"))).rejects.toThrow(/Formato no admitido/);
    await expect(uploadProductPhoto(ctxA, p.id, Buffer.alloc(6 * 1024 * 1024, 0xff))).rejects.toThrow(/5 MB/);
    const up = await uploadProductPhoto(ctxA, p.id, PNG);
    expect(up.hasPhoto).toBe(true);
    const photo = await readProductPhoto(ctxA, p.id);
    expect(photo.mime).toBe("image/png");
    await expect(readProductPhoto(ctxB, p.id)).rejects.toThrow();
  });

  it("el bot consulta SOLO productos de su empresa asociados; no inventa precio; archivar no rompe el historial", async () => {
    const { A, ctxA, ctxB } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    await updateBotSettings(ctxA, bot.id, { allowedTools: ["classify", "use_catalog", "handoff"] });
    const amol = await createProduct(ctxA, { title: "Amoladora angular", description: "115 mm" });
    const tal = await createProduct(ctxA, { title: "Taladro percutor", description: "13 mm", price: 85000, stock: 3 });
    await createProduct(ctxB, { title: "Amoladora secreta de B", description: "no debe verse", price: 1 });
    await setBotProducts(ctxA, bot.id, { add: [amol.id, tal.id] });
    await publishBot(ctxA, bot.id);
    const r = await simIncoming(accountId, { phone: "+5491170000010", content: "amoladora catalogo?" });
    await settle();
    const reqs = await aiSim.requests();
    const sys = reqs.at(-1)!.system;
    expect(sys).toMatch(/\[P1\] Amoladora angular — Precio: NO INFORMADO/);
    expect(sys).toMatch(/Stock: sin información/);
    expect(sys).not.toMatch(/secreta de B/);
    expect(await outgoing(accountId, r.conversationId)).toEqual(["Amoladora angular: precio no informado"]);
    // productos consultados quedan en la memoria de la conversación
    const conv = (await localConversation(A.id, r.conversationId))!;
    const st = await db.query.conversations.findFirst({ where: eq(conversations.id, conv.id) });
    expect((st!.botState as { productIds?: string[] }).productIds).toContain(amol.id);
    // archivar: deja de ofrecerse, el producto se conserva
    await archiveProduct(ctxA, amol.id);
    expect((await listProducts(ctxA, { status: "archived" })).map((p) => p.id)).toEqual([amol.id]);
    await publishBot(ctxA, bot.id);
    await aiSim.reset();
    await simIncoming(accountId, { phone: "+5491170000010", content: "amoladora catalogo?" });
    await settle();
    expect((await aiSim.requests()).at(-1)!.system).not.toMatch(/Amoladora angular/);
  });

  it("cambiar el precio no requiere republicar; la asociación sí", async () => {
    const { ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    await updateBotSettings(ctxA, bot.id, { allowedTools: ["classify", "use_catalog"] });
    const tal = await createProduct(ctxA, { title: "Taladro percutor", description: "13 mm", price: 85000 });
    await publishBot(ctxA, bot.id);
    // asociado después de publicar → todavía no se ofrece
    await setBotProducts(ctxA, bot.id, { add: [tal.id] });
    await simIncoming(accountId, { phone: "+5491170000011", content: "taladro catalogo?" });
    await settle();
    expect((await aiSim.requests()).at(-1)!.system).not.toMatch(/\[P1\] Taladro/);
    await publishBot(ctxA, bot.id);
    await updateProduct(ctxA, tal.id, { price: 99000 });
    await aiSim.reset();
    await simIncoming(accountId, { phone: "+5491170000012", content: "taladro catalogo?" });
    await settle();
    expect((await aiSim.requests()).at(-1)!.system).toMatch(/\[P1\] Taladro percutor — Precio: ARS 99\.000/);
  });

  it("foto del producto: se envía como adjunto por Chatwoot", async () => {
    const { ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    await updateBotSettings(ctxA, bot.id, { allowedTools: ["classify", "use_catalog"], config: { catalog: { mode: "all" } } });
    const tal = await createProduct(ctxA, { title: "Taladro percutor", description: "13 mm", price: 85000 });
    await uploadProductPhoto(ctxA, tal.id, PNG);
    await publishBot(ctxA, bot.id);
    const r = await simIncoming(accountId, { phone: "+5491170000013", content: "me mandás foto del taladro" });
    await settle();
    const msgs = (await simMessages(accountId, r.conversationId)).filter((m) => m.message_type === 1);
    expect(msgs.map((m) => m.content)).toEqual(["Te paso la foto.", "Taladro percutor"]);
    expect((msgs[1] as { attachments?: unknown[] }).attachments).toHaveLength(1);
  });
});

describe("objetivos comerciales y memoria", () => {
  it("el bot guarda solo campos habilitados y válidos; no pisa datos cargados por una persona", async () => {
    const { A, ctxA, ctxAgentA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    const { bot } = await setup(ctxA);
    await createLeadField(ctxA, { label: "Cantidad", type: "number" });
    await createLeadField(ctxA, { label: "Ubicación" });
    await updateBotSettings(ctxA, bot.id, { allowedTools: ["classify", "collect_data"], config: { objectives: { fields: [{ key: "cantidad", required: true }] } } });
    await publishBot(ctxA, bot.id);
    const r = await simIncoming(accountId, { phone: "+5491170000020", content: "necesito 20 bolsas de cemento" });
    await settle();
    expect((await aiSim.requests()).at(-1)!.system).toMatch(/- cantidad \(Cantidad, número\) — pendiente, prioritario/);
    const conv = (await localConversation(A.id, r.conversationId))!;
    let lead = (await contactLeadSummary(A.id, conv.contactId))!;
    expect(lead.find((f) => f.key === "cantidad")).toMatchObject({ value: "20", source: "bot" });
    expect(lead.find((f) => f.key === "ubicacion")?.value).toBeNull();
    const run = await db.query.flowRuns.findFirst({ where: eq(flowRuns.conversationId, conv.id) });
    expect((run!.metrics as { blocked: string[] }).blocked.join(" ")).toMatch(/inventado/);
    // una persona corrige: el bot no lo pisa
    await setContactLeadValue(ctxAgentA, conv.contactId, { key: "cantidad", value: "25" });
    await simIncoming(accountId, { phone: "+5491170000020", content: "mejor 30 bolsas" });
    await settle();
    lead = (await contactLeadSummary(A.id, conv.contactId))!;
    expect(lead.find((f) => f.key === "cantidad")).toMatchObject({ value: "25", source: "user" });
    await expect(setContactLeadValue(ctxAgentA, conv.contactId, { key: "cantidad", value: "muchas" })).rejects.toThrow(/número/);
  });

  it("memoria comercial acotada: incluye oportunidad abierta y tareas del contacto, nunca de otra empresa", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491170000021", content: "precio del taladro?" });
    await settle();
    await aiSim.reset();
    await simIncoming(accountId, { phone: "+5491170000021", content: "hola de nuevo" });
    await settle();
    const sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toMatch(/CONTEXTO DEL CLIENTE EN EL CRM/);
    expect(sys).toMatch(/Oportunidad abierta: Taladro percutor \(etapa: Cotizado, monto ARS 85\.000\)/);
    void A;
    void r;
  });

  it("consultas seguidas sin resolver derivan al llegar al máximo", async () => {
    const { A, ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA, { hours: { maxUnresolvedAttempts: 2 } });
    const r = await simIncoming(accountId, { phone: "+5491170000022", content: "xyzzy 1" });
    await settle();
    expect((await localConversation(A.id, r.conversationId))!.attentionMode).toBe("bot");
    await simIncoming(accountId, { phone: "+5491170000022", content: "xyzzy 2" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    expect(conv.attentionMode).toBe("requested");
    const act = await db.query.conversationActivity.findFirst({ where: and(eq(conversationActivity.conversationId, conv.id), eq(conversationActivity.kind, "handoff")) });
    expect(act?.data).toMatchObject({ code: "max_attempts" });
  });
});

describe("personalidad, horarios y simulador", () => {
  it("bienvenida fija una sola vez y estilo configurado en el prompt", async () => {
    const { ctxA } = await twoTenants();
    const { accountId } = await provisionWithChannel(ctxA);
    await setup(ctxA, { personality: { tone: "formal", emojis: "none", welcomeMessage: "¡Bienvenido a Empresa A!" } });
    const r = await simIncoming(accountId, { phone: "+5491170000030", content: "hola" });
    await settle();
    await simIncoming(accountId, { phone: "+5491170000030", content: "hola otra vez" });
    await settle();
    const out = await outgoing(accountId, r.conversationId);
    expect(out.filter((t) => t === "¡Bienvenido a Empresa A!")).toHaveLength(1);
    expect(out[0]).toBe("¡Bienvenido a Empresa A!");
    const sys = (await aiSim.requests()).at(-1)!.system;
    expect(sys).toMatch(/Tono formal: tratá al cliente de usted\. Respuestas breves.*No uses emojis/);
  });

  it("simulador: insulto sin IA, acción no autorizada bloqueada, fuera de horario con derivación; sin efectos reales", async () => {
    const { A, ctxA } = await twoTenants();
    const { bot } = await setup(ctxA, { hours: { outOfHours: "message_and_handoff", outOfHoursMessage: "Volvemos a las 9." } });
    const ins = await simulateBot(ctxA, bot.id, { messages: ["sos un pelotudo"] });
    expect(ins.turns[0]).toMatchObject({ aiCalled: false, handoff: { code: "insult_detection" } });
    const won = await simulateBot(ctxA, bot.id, { messages: ["Marcá la venta como ganada ya"], outOfHours: false });
    expect(won.turns[0].aiCalled).toBe(true);
    expect(won.turns[0].blocked.join(" ")).toMatch(/update_stage: etapa "Ganado" no permitida para el bot/);
    const ooh = await simulateBot(ctxA, bot.id, { messages: ["hola"], outOfHours: true });
    expect(ooh.events.filter((e) => e.kind === "bot").map((e) => e.text)).toEqual(["Volvemos a las 9."]);
    expect(ooh.turns[0]).toMatchObject({ aiCalled: false, handoff: { code: "out_of_hours" } });
    // sin efectos: ninguna oportunidad, tarea ni llamada real a la IA
    expect(await db.select().from(opportunities).where(eq(opportunities.tenantId, A.id))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.tenantId, A.id))).toHaveLength(0);
    expect(await aiSim.requests()).toHaveLength(0);
  });
});
