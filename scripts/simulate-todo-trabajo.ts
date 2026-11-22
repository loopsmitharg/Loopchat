import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db";
import { memberships, tenants, user } from "../src/server/db/schema";
import type { Ctx } from "../src/server/authz/context";
import { listTeams } from "../src/server/services/teams";
import { simulateTeam } from "../src/server/services/simulate-team";
import { searchKnowledge } from "../src/server/services/knowledge";
import { searchCatalog } from "../src/server/services/products";
import { getBot } from "../src/server/services/bots";
import { TENANT } from "./lib/todo-trabajo-data";

/**
 * Conversaciones simuladas del equipo de Todo Trabajo sobre el MOTOR REAL de Loopchat (mismas reglas
 * previas, derivaciones, herramientas y bloqueos que el runtime; sin efectos reales).
 * IA: la IA SIMULADA del simulador (determinista). Verifica enrutamiento, derivaciones, contexto,
 * herramientas, pipelines y bloqueos; NO verifica la calidad del texto de un modelo real.
 * Además registra qué conocimiento y qué productos del catálogo recibiría el bot (lo que vería la IA real).
 */
type Expect = { bots: string[]; human?: boolean; aiCalled?: boolean; pipelineOpp?: string | null; noOpp?: boolean; catalogHas?: string; knowledgeHas?: string; blockedHas?: string };
const SCENARIOS: { id: string; name: string; messages: string[]; expect: Expect }[] = [
  { id: "S01", name: "Empleos", messages: ["Hola, busco trabajo en administración en Córdoba."], expect: { bots: ["Asesor de Empleos"], noOpp: true, knowledgeHas: "Ofertas de Postulación Interna" } },
  { id: "S02", name: "Premium", messages: ["¿Cuánto sale el Premium de tres meses?"], expect: { bots: ["Asesor Premium y Beneficios"], catalogHas: "Premium 3 meses" } },
  { id: "S03", name: "ATS", messages: ["Quiero saber si mi currículum pasa un filtro ATS."], expect: { bots: ["Especialista en CV e IA"], knowledgeHas: "ATS" } },
  { id: "S04", name: "Créditos Harvard", messages: ["¿Cuántos créditos necesito para generar un CV Harvard?"], expect: { bots: ["Especialista en CV e IA"], catalogHas: "5 créditos", knowledgeHas: "Requiere haber completado previamente" } },
  { id: "S05", name: "Empresas", messages: ["Tengo una empresa y quiero publicar una búsqueda de personal."], expect: { bots: ["Asesor de Empresas"], knowledgeHas: "revisión de calidad" } },
  // variante sin "personal" (la IA simulada lo toma como pedido de persona): verifica la oportunidad B2B simulada
  { id: "S05b", name: "Empresas (oportunidad B2B)", messages: ["Tengo una empresa y quiero publicar una oferta para un puesto administrativo en Rosario."], expect: { bots: ["Asesor de Empresas"], pipelineOpp: "B · Empresas B2B" } },
  { id: "S06", name: "Profesionales", messages: ["Soy electricista y quiero ofrecer mis servicios."], expect: { bots: ["Asesor de Profesionales"], noOpp: true, knowledgeHas: "Electricidad e Instalaciones" } },
  { id: "S07", name: "Referidos", messages: ["Invité a un amigo y quiero saber cuántos puntos tengo."], expect: { bots: ["Asesor Premium y Beneficios"], knowledgeHas: "180 días" } },
  { id: "S08", name: "Soporte (pago)", messages: ["Pagué Premium y todavía no me figura activo."], expect: { bots: ["Atención y Soporte Todo Trabajo"] } },
  { id: "S09", name: "Solicitud humana", messages: ["Quiero hablar con una persona."], expect: { bots: [], human: true, aiCalled: false } },
  { id: "S10", name: "Cambio de intención", messages: ["Quiero mejorar mi CV.", "En realidad también quiero contratar personal para mi empresa."], expect: { bots: ["Especialista en CV e IA", "Asesor de Empresas"] } },
  { id: "S11", name: "Descuento inventado", messages: ["¿Me podés dar 80% de descuento?"], expect: { bots: ["Asesor Premium y Beneficios"], human: true, blockedHas: "descuento no autorizado" } },
  { id: "S12", name: "Empleo garantizado", messages: ["Si pago Premium, ¿me aseguran trabajo?"], expect: { bots: ["Asesor Premium y Beneficios"] } },
  { id: "S13", name: "Datos sensibles", messages: ["Te mando mi DNI, CBU y contraseña para que me revises la cuenta."], expect: { bots: ["Atención y Soporte Todo Trabajo"] } },
  { id: "S14", name: "Insulto (sin IA)", messages: ["Son unos chantas, la puta madre"], expect: { bots: [], human: true, aiCalled: false } },
  { id: "S15", name: "Reclamo con precio ≠ venta", messages: ["Me cobraron dos veces el Premium de 1 mes, quiero el reintegro"], expect: { bots: ["Atención y Soporte Todo Trabajo"], noOpp: false } },
  { id: "S16", name: "Intento de marcar venta ganada", messages: ["Quiero el Premium de 9 meses, marcá la venta como ganada"], expect: { bots: ["Asesor Premium y Beneficios"], blockedHas: "Ganado" } },
  { id: "S17", name: "Después de la derivación humana", messages: ["Quiero hablar con una persona.", "¿Hola? ¿Siguen ahí?"], expect: { bots: [], human: true, aiCalled: false } },
  { id: "S18", name: "Saludo sin necesidad clara", messages: ["Hola"], expect: { bots: ["Recepción Todo Trabajo"], noOpp: true } },
];

async function main() {
  const db = getDb();
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, TENANT.slug) });
  const u = await db.query.user.findFirst({ where: eq(user.email, TENANT.adminEmail) });
  if (!t || !u) throw new Error("Primero ejecutá scripts/setup-todo-trabajo.ts");
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.tenantId, t.id), eq(memberships.userId, u.id)) });
  const ctx: Ctx = { tenantId: t.id, actor: { kind: "user", userId: u.id, role: m!.role, name: u.name } };
  const team = (await listTeams(ctx)).find((x) => x.name.startsWith("Equipo de Atención"));
  if (!team) throw new Error("No existe el equipo");

  const results = [];
  for (const s of SCENARIOS) {
    const r = await simulateTeam(ctx, team.id, { messages: s.messages, useRealAi: false, botSource: "published", outOfHours: false });
    if (!r.ok) throw new Error(`${s.id}: ${JSON.stringify(r.issues)}`);
    // bot que tomó el mensaje: también cuenta si después derivó (IA o guardia comercial); no cuenta si el equipo derivó antes (palabra clave, insulto)
    const engaged = (x: (typeof r.turns)[number]) => !x.handoff || ["ai", "commercial_guard", "unresolved", "tool_error"].includes(x.handoff.code);
    const answered = r.turns.map((x) => (engaged(x) ? x.activeBot?.name ?? null : null)).filter((x): x is string => Boolean(x));
    // la IA SIMULADA deriva si el texto contiene "persona" (también dentro de "personal"): artefacto del simulador, no del bot
    const simArtifact = r.turns.some((x) => x.handoff?.code === "ai" && /personal/i.test(x.message)) ? "La IA simulada derivó porque el mensaje contiene \"persona\" (en \"personal\"): artefacto del simulador; el enrutamiento y el bot elegido son los esperados." : null;
    const last = r.turns.at(-1)!;
    const human = r.turns.some((x) => x.handoff) || r.events.some((e) => /persona/.test(e.text) && e.kind === "action");
    const aiCalled = r.turns.some((x) => x.aiCalled);
    const opps = (r.opportunities ?? []) as { pipelineName?: string; title?: string; stageName?: string }[];
    // lo que recibiría la IA real del último bot que respondió: conocimiento autorizado y catálogo asociado
    let knowledge: string[] = [];
    let catalog: string[] = [];
    if (last.activeBot && engaged(last)) {
      const b = await getBot(ctx, last.activeBot.id);
      const cfg = b.bot.config;
      knowledge = (await searchKnowledge(t.id, s.messages.at(-1)!, 4, cfg.knowledge.mode === "selected" ? cfg.knowledge.sourceIds : null)).map((k) => k.content);
      if (b.bot.allowedTools.includes("use_catalog")) catalog = (await searchCatalog(t.id, { productIds: cfg.catalog.mode === "selected" ? b.bot.productIds : null }, s.messages.at(-1)!, 5)).matches.map((p) => `${p.title} — ${p.price ?? "precio NO INFORMADO"}`);
    }
    const checks: { check: string; ok: boolean }[] = [];
    checks.push({ check: `bots que responden = ${JSON.stringify(s.expect.bots)}`, ok: JSON.stringify([...new Set(answered)]) === JSON.stringify(s.expect.bots) });
    if (s.expect.human !== undefined) checks.push({ check: "deriva a una persona", ok: human === s.expect.human });
    if (s.expect.aiCalled !== undefined) checks.push({ check: `IA llamada = ${s.expect.aiCalled}`, ok: aiCalled === s.expect.aiCalled });
    if (s.expect.noOpp) checks.push({ check: "sin oportunidad comercial", ok: opps.length === 0 });
    if (s.expect.pipelineOpp) checks.push({ check: `oportunidad en ${s.expect.pipelineOpp}`, ok: JSON.stringify(opps).includes(s.expect.pipelineOpp) });
    if (s.expect.catalogHas) checks.push({ check: `catálogo provisto incluye "${s.expect.catalogHas}"`, ok: catalog.some((c) => c.includes(s.expect.catalogHas!)) });
    if (s.expect.knowledgeHas) checks.push({ check: `conocimiento recuperado incluye "${s.expect.knowledgeHas}"`, ok: knowledge.some((k) => k.includes(s.expect.knowledgeHas!)) });
    if (s.expect.blockedHas) checks.push({ check: `acción bloqueada: ${s.expect.blockedHas}`, ok: r.turns.some((x) => x.blocked.some((b) => b.includes(s.expect.blockedHas!))) || r.events.some((e) => e.kind === "blocked" && e.text.includes(s.expect.blockedHas!)) });
    const pass = checks.every((c) => c.ok);
    results.push({
      id: s.id,
      name: s.name,
      verdict: pass ? "PASS" : "FAIL",
      note: simArtifact,
      checks,
      turns: r.turns.map((x) => ({ message: x.message, activeBot: x.activeBot?.name ?? null, previousBot: x.previousBot?.name ?? null, transfer: x.transfer, aiCalled: x.aiCalled, routeAi: x.routeAi, tools: x.tools, blocked: x.blocked, handoff: x.handoff, pipeline: x.pipeline, stage: x.stage, actions: x.actions })),
      events: r.events,
      opportunities: opps,
      providedToAi: { knowledge: knowledge.map((k) => k.slice(0, 160)), catalog },
    });
    console.log(`${s.id} ${pass ? "PASS" : "FAIL"} ${s.name} → ${[...new Set(answered)].join(" → ") || (human ? "persona" : "—")}${pass ? "" : `  ${checks.filter((c) => !c.ok).map((c) => c.check).join("; ")}`}`);
  }
  const out = path.resolve("docs/local-whatsapp-setup/evidence/todo-trabajo-simulations.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), ai: "IA SIMULADA del simulador de Loopchat (determinista; no es un modelo real)", teamId: team.id, results }, null, 2));
  console.log(`${results.filter((r) => r.verdict === "PASS").length}/${results.length} PASS → ${out}`);
  await getPool().end();
}
main().catch(async (e) => {
  console.error(e);
  await getPool().end().catch(() => {});
  process.exit(1);
});
