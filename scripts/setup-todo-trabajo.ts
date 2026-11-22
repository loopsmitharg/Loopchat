import "dotenv/config";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db";
import { memberships, tenants, user } from "../src/server/db/schema";
import type { Ctx } from "../src/server/authz/context";
import { createTenant } from "../src/server/services/tenants";
import { provisionChatwootAccount } from "../src/server/services/chatwoot-provisioning";
import { acceptInvitation } from "../src/server/services/invitations";
import { updateTenantSettings } from "../src/server/services/tenant-settings";
import { createRule, getAiProfile, updateAiProfile } from "../src/server/services/ai-profile";
import { addTextSource, deleteKnowledge, listKnowledge } from "../src/server/services/knowledge";
import { createProduct, listProducts, setBotProducts, updateProduct, listBotProductIds } from "../src/server/services/products";
import { createPipeline, listPipelines, savePipelineStages } from "../src/server/services/pipelines";
import { createAiConnection, listAiConnections } from "../src/server/services/ai-connections";
import { createBot, getBot, listBots, publishBot, updateBotSettings } from "../src/server/services/bots";
import { createTeam, getTeam, listTeams, publishTeam, saveTeamDraft, setTeamStatus } from "../src/server/services/teams";
import type { TeamEdge, TeamGraph } from "../src/lib/team/types";
import { BOTS, COMPANY_PROFILE, COMPANY_RULES, CROSS_KEYWORDS, ENTRY_KEYWORDS, FROM_SUPPORT, HANDOFF_KEYWORDS, PIPELINES, PRODUCTS, TENANT, extractSections, type BotKey } from "./lib/todo-trabajo-data";

/**
 * Configura (idempotente) la empresa Todo Trabajo en Loopchat usando los servicios reales:
 * empresa + administradora, perfil e identidad de IA, reglas obligatorias, conocimiento (secciones
 * literales del dossier), catálogo, pipelines, 7 bots publicados y el equipo multiagente activo.
 *   TODO_TRABAJO_DOSSIER=../TodoTrabajo/docs/informacion-empresarial-y-comercial.md npx tsx --conditions=react-server scripts/setup-todo-trabajo.ts
 * No toca otras empresas. Volver a ejecutarlo no duplica nada: actualiza y publica solo si hay cambios.
 */
const TEAM_NAME = "Equipo de Atención — Todo Trabajo";
const AI_SIM_LABEL = "Simulador de IA local (NO es IA real)";
const log = (...a: unknown[]) => console.log("·", ...a);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Ejecutar con NODE_ENV de desarrollo (entorno local).");
  const dossierPath = path.resolve(process.env.TODO_TRABAJO_DOSSIER ?? "../TodoTrabajo/docs/informacion-empresarial-y-comercial.md");
  const dossier = fs.readFileSync(dossierPath, "utf8");
  const db = getDb();
  const report: Record<string, unknown> = { dossier: dossierPath };

  /* 1) Empresa (sin duplicar: por identificador o por nombre) ----------------------------- */
  let tenant = (await db.query.tenants.findFirst({ where: eq(tenants.slug, TENANT.slug) })) ?? (await db.query.tenants.findFirst({ where: eq(tenants.name, TENANT.name) }));
  let invitationUrl: string | null = null;
  if (!tenant) {
    const r = await createTenant({ name: TENANT.name, slug: TENANT.slug, planCode: TENANT.plan, adminEmail: TENANT.adminEmail, subscriptionStatus: "active" }, null);
    tenant = r.tenant;
    invitationUrl = r.invitation.url;
    log("empresa creada", tenant.id);
  } else log("empresa existente reutilizada", tenant.id);
  report.tenant = { id: tenant.id, slug: tenant.slug, name: tenant.name, created: Boolean(invitationUrl) };

  /* 2) Administradora local (acepta la invitación real; contraseña solo en un archivo ignorado por Git) */
  let admin = await db.query.user.findFirst({ where: eq(user.email, TENANT.adminEmail) });
  if (!admin && invitationUrl) {
    const password = randomBytes(18).toString("base64url");
    await acceptInvitation({ token: invitationUrl.split("/").pop()!, name: TENANT.adminName, password }, null);
    const credFile = path.resolve("storage/todo-trabajo-admin.local.txt");
    fs.mkdirSync(path.dirname(credFile), { recursive: true });
    fs.writeFileSync(credFile, `Usuario local de Todo Trabajo (solo este entorno; no commitear)\nemail=${TENANT.adminEmail}\npassword=${password}\n`);
    admin = await db.query.user.findFirst({ where: eq(user.email, TENANT.adminEmail) });
    log("administradora creada; credenciales en storage/todo-trabajo-admin.local.txt");
  }
  if (!admin) throw new Error("La empresa existe pero no hay administradora: aceptá la invitación pendiente desde la app.");
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, admin.id)) });
  if (!m || m.role !== "tenant_admin") throw new Error("La administradora no es tenant_admin de Todo Trabajo.");
  const ctx: Ctx = { tenantId: tenant.id, actor: { kind: "user", userId: admin.id, role: m.role, name: admin.name } };

  /* 3) Datos de la empresa e identidad de IA --------------------------------------------- */
  // sin horario: el dossier no lo informa (los bots atienden siempre y derivan a personas)
  await updateTenantSettings(ctx, { timezone: "America/Argentina/Buenos_Aires", defaultCurrency: "ARS", autoCreateOpportunity: false });
  await updateAiProfile(ctx, COMPANY_PROFILE);
  const existingRules = (await getAiProfile(ctx)).rules;
  for (const r of COMPANY_RULES) if (!existingRules.some((x) => x.text === r.text)) await createRule(ctx, { ...r, mandatory: true, enabled: true });
  report.rules = (await getAiProfile(ctx)).rules.filter((r) => r.mandatory && r.enabled).length;
  log("perfil de IA y reglas obligatorias:", report.rules);

  /* 4) Conocimiento: un documento por tema, texto literal del dossier ---------------------- */
  const sections = extractSections(dossier);
  let sources = await listKnowledge(ctx);
  const knowledgeIds: Record<string, string> = {};
  for (const s of sections) {
    const found = sources.find((x) => x.title === s.title);
    if (found && found.charCount === s.content.length) {
      knowledgeIds[s.key] = found.id;
      continue;
    }
    if (found) await deleteKnowledge(ctx, found.id); // el dossier cambió: se reemplaza el documento
    knowledgeIds[s.key] = (await addTextSource(ctx, { title: s.title, content: s.content })).id;
  }
  sources = await listKnowledge(ctx);
  report.knowledge = sections.map((s) => ({ key: s.key, title: s.title, chars: s.content.length }));
  log("conocimiento:", sections.length, "documentos");

  /* 5) Catálogo (stock sin informar; precio solo si el dossier lo da) ----------------------- */
  const productIds: Record<string, string> = {};
  const current = await listProducts(ctx, { status: "all" } as never);
  for (const p of PRODUCTS) {
    const found = current.find((x) => x.title === p.title);
    if (found) {
      if (found.description !== p.description || (found.price === null ? null : Number(found.price)) !== p.price) await updateProduct(ctx, found.id, { description: p.description, price: p.price });
      productIds[p.key] = found.id;
    } else productIds[p.key] = (await createProduct(ctx, { title: p.title, description: p.description, price: p.price, stock: null, active: true })).id;
  }
  report.products = PRODUCTS.map((p) => ({ title: p.title, price: p.price }));
  log("catálogo:", PRODUCTS.length, "productos");

  /* 6) Pipelines: se renombra el pipeline inicial "Ventas" (vacío) y se crean los que faltan --- */
  let pls = await listPipelines(ctx);
  const pipelineIds: Record<string, string> = {};
  for (const spec of PIPELINES) {
    let p = pls.find((x) => x.name === spec.name);
    if (!p && spec.key === "premium") p = pls.find((x) => x.name === "Ventas" && x.isDefault);
    if (!p) {
      await createPipeline(ctx, { name: spec.name });
      pls = await listPipelines(ctx);
      p = pls.find((x) => x.name === spec.name)!;
    }
    const same = p.name === spec.name && p.stages.length === spec.stages.length && p.stages.every((s, i) => s.name === spec.stages[i].name && s.kind === spec.stages[i].kind);
    if (!same) {
      // reutiliza las etapas por posición (no se borra ninguna con oportunidades: lo valida el servicio)
      await savePipelineStages(ctx, p.id, { name: spec.name, stages: spec.stages.map((s, i) => ({ ...s, ...(p!.stages[i] ? { id: p!.stages[i].id } : {}) })) });
    }
    pipelineIds[spec.key] = p.id;
  }
  pls = await listPipelines(ctx);
  report.pipelines = pls.map((p) => ({ name: p.name, stages: p.stages.map((s) => `${s.name}${s.kind !== "open" ? ` (${s.kind})` : ""}`) }));
  log("pipelines:", pls.map((p) => p.name).join(" | "));

  /* 7) Conexión de IA: SIMULADOR local rotulado (necesaria para publicar bots por instrucciones).
        En el runtime real (producción) la URL privada se bloquea → el bot deriva a una persona.
        Con una clave real: crear la conexión real y volver a ejecutar con TODO_TRABAJO_AI_CONNECTION_ID. */
  let aiConnectionId = process.env.TODO_TRABAJO_AI_CONNECTION_ID ?? null;
  if (!aiConnectionId) {
    const conns = await listAiConnections(ctx);
    const sim = conns.find((c) => c.label === AI_SIM_LABEL);
    if (sim) aiConnectionId = sim.id;
    else {
      const prev = process.env.LOOPCHAT_ALLOW_PRIVATE_URLS;
      process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = "true"; // solo este proceso local: URL del simulador del repo
      aiConnectionId = (await createAiConnection(ctx, { provider: "openai_compatible", label: AI_SIM_LABEL, apiKey: "simulador-local-sin-valor", baseUrl: "http://localhost:3012/v1", defaultModel: "simulador" })).id;
      process.env.LOOPCHAT_ALLOW_PRIVATE_URLS = prev;
    }
  }
  report.aiConnection = { id: aiConnectionId, real: Boolean(process.env.TODO_TRABAJO_AI_CONNECTION_ID) };

  /* 8) Bots ------------------------------------------------------------------------------ */
  const allBots = await listBots(ctx);
  const botIds = {} as Record<BotKey, string>;
  const botReport: unknown[] = [];
  for (const spec of BOTS) {
    const pipelineId = spec.pipeline ? pipelineIds[spec.pipeline] : null;
    const pipelineStages = pls.find((p) => p.id === pipelineId)?.stages ?? [];
    const config = {
      ...spec.config,
      knowledge: { mode: "selected" as const, sourceIds: spec.knowledge.map((k) => knowledgeIds[k]) },
      pipeline: {
        ...spec.config.pipeline,
        primaryPipelineId: pipelineId,
        extraPipelineIds: [],
        initialStageId: pipelineStages[0]?.id ?? null,
        quoteStageId: null,
      },
      tools: { ...spec.config.tools, allowedStageIds: pipelineStages.filter((s) => s.kind === "open").map((s) => s.id) },
    };
    const fields = { role: spec.role, aiConnectionId, instructions: spec.instructions, allowedTools: spec.tools, handoffKeywords: HANDOFF_KEYWORDS, channelConnectionId: null, config };
    let b = allBots.find((x) => x.name === spec.name);
    if (!b) {
      const created = await createBot(ctx, { name: spec.name, mode: "instructions", ...fields });
      b = { ...created } as unknown as (typeof allBots)[number];
    } else await updateBotSettings(ctx, b.id, fields);
    botIds[spec.key] = b.id;
    const want = spec.products.map((k) => productIds[k]);
    const have = await listBotProductIds(ctx, b.id);
    await setBotProducts(ctx, b.id, { add: want.filter((id) => !have.includes(id)), remove: have.filter((id) => !want.includes(id)) });
    const detail = await getBot(ctx, b.id);
    let version = detail.versions[0]?.version ?? null;
    if (detail.unpublishedChanges || !detail.bot.publishedVersionId) version = (await publishBot(ctx, b.id)).version;
    botReport.push({ key: spec.key, id: b.id, name: spec.name, role: spec.role, version, tools: spec.tools, knowledge: spec.knowledge, products: spec.products.length, pipeline: spec.pipeline });
  }
  report.bots = botReport;
  log("bots publicados:", BOTS.length);

  /* 9) Equipo multiagente ----------------------------------------------------------------- */
  const node = (k: BotKey) => `bot-${k}`;
  const edges: TeamEdge[] = [];
  const edge = (from: BotKey, to: BotKey | "human", keywords: string[], label: string) => edges.push({ id: `e-${from}-${to}`, source: node(from), target: to === "human" ? "human" : node(to), data: { condition: { kind: "keywords", keywords }, enabled: true, label } });
  const specialists = BOTS.map((b) => b.key).filter((k) => k !== "recepcion") as Exclude<BotKey, "recepcion">[];
  const LABEL: Record<string, string> = { human: "Atención humana", soporte: "Problemas y reclamos", empresas: "Empresas y reclutamiento", profesionales: "Profesionales independientes", premium: "Premium, puntos y referidos", cv: "CV, ATS y créditos IA", empleos: "Empleos y postulaciones" };
  // Recepción: el orden importa (gana la primera coincidencia): persona > problema > empresa > profesional > premium > CV > empleo
  edge("recepcion", "human", ENTRY_KEYWORDS.human, LABEL.human);
  for (const k of ["soporte", "empresas", "profesionales", "premium", "cv", "empleos"] as const) edge("recepcion", k, ENTRY_KEYWORDS[k], LABEL[k]);
  // una sola derivación por par de nodos (lo exige la validación): sin coincidencia de palabras clave la
  // recepción pregunta (o, con IA real, clasifica entre estas mismas derivaciones)
  for (const from of specialists) {
    edge(from, "human", ENTRY_KEYWORDS.human, LABEL.human);
    if (from === "soporte") {
      for (const [to, kws] of Object.entries(FROM_SUPPORT)) edge("soporte", to as BotKey, kws!, LABEL[to]);
      continue;
    }
    edge(from, "soporte", CROSS_KEYWORDS.soporte, LABEL.soporte);
    for (const to of specialists) if (to !== from && to !== "soporte") edge(from, to, CROSS_KEYWORDS[to], LABEL[to]);
  }
  const pos: Record<BotKey, { x: number; y: number }> = { recepcion: { x: 520, y: 0 }, empleos: { x: 0, y: 220 }, premium: { x: 260, y: 220 }, cv: { x: 520, y: 220 }, empresas: { x: 780, y: 220 }, profesionales: { x: 1040, y: 220 }, soporte: { x: 260, y: 440 } };
  const graph: TeamGraph = {
    nodes: [...BOTS.map((b) => ({ id: node(b.key), type: "bot" as const, position: pos[b.key], data: { botId: botIds[b.key] } })), { id: "human", type: "human" as const, position: { x: 780, y: 440 }, data: {} }],
    edges,
    // la recepción pregunta si no entiende; 2 derivaciones seguidas como máximo; bot no disponible → recepción
    settings: { entryNodeId: node("recepcion"), unknownIntent: "stay", maxConsecutiveTransfers: 2, fallback: "entry" },
    automations: [],
  };
  let team = (await listTeams(ctx)).find((t) => t.name === TEAM_NAME);
  if (!team) {
    const t = await createTeam(ctx, { name: TEAM_NAME, description: "Recepción + 6 especialistas de Todo Trabajo. Derivación por palabras clave (sin IA), protección de bucles y derivación a personas.", channelConnectionId: null, graph });
    team = (await listTeams(ctx)).find((x) => x.id === t.id)!;
  } else {
    const cur = await getTeam(ctx, team.id);
    await saveTeamDraft(ctx, team.id, { graph, revision: cur.team.draftRevision });
  }
  const t = await getTeam(ctx, team.id);
  const errors = t.issues.filter((i) => i.severity === "error");
  if (errors.length) throw new Error(`El equipo tiene errores: ${JSON.stringify(errors)}`);
  let teamVersion = t.published?.version ?? null;
  // se republica si cambió el grafo o la versión publicada de algún bot
  const publishedNow = new Map((await listBots(ctx)).map((b) => [b.id, b.publishedVersionId as string | null]));
  const pinned = (t.published?.botVersions ?? {}) as Record<string, string>;
  const pinnedStale = Object.values(botIds).some((id) => pinned[id] !== publishedNow.get(id));
  if (t.unpublishedChanges || !t.published || pinnedStale) teamVersion = (await publishTeam(ctx, team.id)).version;
  await setTeamStatus(ctx, team.id, "active");
  report.team = { id: team.id, name: TEAM_NAME, version: teamVersion, status: "active", edges: edges.length, warnings: t.issues.filter((i) => i.severity !== "error").map((i) => i.message) };
  log("equipo publicado y activo: versión", teamVersion, `(${edges.length} derivaciones)`);

  /* 10) Cuenta propia en Chatwoot (Platform API) con webhook firmado hacia la URL pública de Loopchat */
  if (process.env.CHATWOOT_BASE_URL && process.env.CHATWOOT_PLATFORM_TOKEN) {
    const cw = await provisionChatwootAccount(tenant.id, null);
    report.chatwoot = cw;
    log("Chatwoot:", cw.created ? "cuenta creada" : "cuenta existente", cw.chatwootAccountId);
  }

  const out = path.resolve("storage/todo-trabajo-setup.json");
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
  log("informe:", out);
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e?.details ? `${e.message} ${JSON.stringify(e.details)}` : e);
  await getPool().end().catch(() => {});
  process.exit(1);
});
