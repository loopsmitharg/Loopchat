// HARNESS DE AUDITORÍA — pruebas HTTP negativas de aislamiento multiempresa y roles contra la app
// local con datos DEMO (npm run db:seed:demo && db:seed:demo-sim). No toca datos reales.
// Uso: node tests/audit/http-tenancy.audit.mjs [http://localhost:3000]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASS = "demo-loopchat-123";
const results = [];
const rec = (id, check, expected, obtained, ok) => results.push({ id, check, expected, obtained, verdict: ok ? "PASS" : "FAIL" });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, password: PASS }) });
  const cookies = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return cookies;
}
const req = (cookie, method, p, body, extra = {}) =>
  fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
const ids = async (cookie, p) => {
  const r = await req(cookie, "GET", p);
  const t = await r.text();
  return [...new Set(t.match(UUID) ?? [])];
};

const A = await login("admin@ferreteria.demo.loopchat.test");
const B = await login("admin@optica.demo.loopchat.test");
const viewerA = await login("lectura@ferreteria.demo.loopchat.test");
const agentA = await login("agente@ferreteria.demo.loopchat.test");

// IDs propios de B (vistos con la sesión de B)
const listB = {};
for (const p of ["contacts", "conversations", "opportunities", "bots", "products", "knowledge", "ai-connections", "pipelines", "tasks", "members", "channels", "teams"]) listB[p] = await ids(B, `/api/v1/${p}`);
const listA = {};
for (const p of ["contacts", "pipelines", "members"]) listA[p] = await ids(A, `/api/v1/${p}`);
const leakIn = (txt, arr) => arr.some((id) => txt.includes(id));

// 1) A intenta leer/escribir recursos de B por ID en la URL
const probes = [
  ["GET", "contacts", (id) => `/api/v1/contacts/${id}`],
  ["PATCH", "contacts", (id) => `/api/v1/contacts/${id}`, { name: "hack" }],
  ["GET", "contacts", (id) => `/api/v1/contacts/${id}/lead-data`],
  ["GET", "conversations", (id) => `/api/v1/conversations/${id}`],
  ["POST", "conversations", (id) => `/api/v1/conversations/${id}/messages`, { text: "hola", idempotencyKey: "audit-xtenant-0001" }],
  ["POST", "conversations", (id) => `/api/v1/conversations/${id}/notes`, { body: "nota", text: "nota" }],
  ["POST", "conversations", (id) => `/api/v1/conversations/${id}/status`, { status: "resolved" }],
  ["PATCH", "opportunities", (id) => `/api/v1/opportunities/${id}`, { title: "hack" }],
  ["GET", "bots", (id) => `/api/v1/bots/${id}`],
  ["GET", "bots", (id) => `/api/v1/bots/${id}/runs`],
  ["POST", "bots", (id) => `/api/v1/bots/${id}/publish`, {}],
  ["PATCH", "products", (id) => `/api/v1/products/${id}`, { title: "hack" }],
  ["GET", "products", (id) => `/api/v1/products/${id}/photo`],
  ["DELETE", "knowledge", (id) => `/api/v1/knowledge/${id}`],
  ["DELETE", "ai-connections", (id) => `/api/v1/ai-connections/${id}`],
  ["PATCH", "tasks", (id) => `/api/v1/tasks/${id}`, { status: "done" }],
  ["PATCH", "members", (id) => `/api/v1/members/${id}`, { status: "disabled" }],
  ["POST", "channels", (id) => `/api/v1/channels/${id}/disconnect`, {}],
  ["GET", "teams", (id) => `/api/v1/teams/${id}`],
];
let tried = 0;
let leaks = 0;
const bad = [];
for (const [method, key, mk, body] of probes) {
  for (const id of (listB[key] ?? []).slice(0, 3)) {
    tried++;
    const r = await req(A, method, mk(id), body);
    const t = await r.text();
    // 200 con lista vacía (p. ej. /bots/:id/runs filtra por tenant) no expone datos: solo se cuenta si hay eco/datos
    if ((r.status < 400 && t.trim() !== "[]") || t.includes(id)) {
      leaks++;
      bad.push(`${method} ${mk(id)} → ${r.status}`);
    }
  }
}
rec("T1", "Empresa A accede por ID a recursos de B (URL)", "4xx sin filtrar datos", `${tried} intentos; respuestas no denegadas o con eco del id=${leaks} ${bad.slice(0, 5).join("; ")}`, tried > 20 && leaks === 0);

// 2) IDs de B en el cuerpo de escrituras de A (IDOR por referencia)
const stageB = listB.pipelines[0];
const contactB = listB.contacts[0];
const contactA = listA.contacts[0];
const r2 = await req(A, "POST", "/api/v1/opportunities", { title: "IDOR", contactId: contactB, pipelineId: stageB });
const r3 = await req(A, "POST", "/api/v1/opportunities", { title: "IDOR2", contactId: contactA, pipelineId: stageB, stageId: stageB });
const r4 = await req(A, "POST", "/api/v1/tasks", { title: "IDOR", dueAt: new Date(Date.now() + 864e5).toISOString(), contactId: contactB });
rec("T2", "A crea oportunidad/tarea referenciando contacto/pipeline de B", "4xx", `opp(contacto B)=${r2.status}; opp(pipeline B)=${r3.status}; tarea(contacto B)=${r4.status}`, [r2, r3, r4].every((r) => r.status >= 400));

// 3) Cookie de empresa manipulada: A fija loopchat_tenant con el id de la empresa B
const tenantB = (await (await req(B, "GET", "/api/v1/tenant")).json())?.tenant?.id ?? (await (await req(B, "GET", "/api/v1/tenant")).text()).match(UUID)?.[0];
const r5 = await req(`${A}; loopchat_tenant=${tenantB}`, "GET", "/api/v1/contacts");
const t5 = await r5.text();
rec("T3", "A fuerza la cookie de empresa con el id de B", "Ignorada (sin datos de B)", `status=${r5.status}; datos de B presentes=${leakIn(t5, listB.contacts)}`, !leakIn(t5, listB.contacts));
const r6 = await req(A, "POST", "/api/v1/session/tenant", { tenantId: tenantB });
rec("T4", "A cambia de empresa activa a B por API", "4xx", `status=${r6.status}`, r6.status >= 400);

// 4) Roles: lectura y agente
const v1 = await req(viewerA, "POST", "/api/v1/contacts", { name: "x", phone: "+5491122334455" });
const v2 = await req(viewerA, "POST", "/api/v1/bots", { name: "Bot lectura", mode: "instructions", instructions: "x", allowedTools: ["classify"], handoffKeywords: [] });
const v3 = await req(viewerA, "GET", "/api/v1/export?type=contacts");
const g1 = await req(agentA, "POST", "/api/v1/ai-connections", { provider: "openai_compatible", label: "Agente", apiKey: "xxxxxxxxxxxxxxxx", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" });
const g2 = await req(agentA, "PATCH", "/api/v1/tenant", { name: "hack" });
const g3 = await req(agentA, "GET", "/api/v1/audit");
rec("T5", "Rol lectura intenta crear contacto/bot y exportar", "403", `contacto=${v1.status}; bot=${v2.status}; export=${v3.status}`, [v1, v2, v3].every((r) => r.status === 403));
rec("T6", "Rol agente intenta credenciales IA, datos de empresa y auditoría", "403", `ai=${g1.status}; tenant=${g2.status}; audit=${g3.status}`, [g1, g2, g3].every((r) => r.status === 403));
const p1 = await req(A, "GET", "/api/platform/tenants");
const p2 = await req(A, "GET", "/api/platform/overview");
rec("T7", "Admin de empresa llama al panel de plataforma", "403/404", `tenants=${p1.status}; overview=${p2.status}`, p1.status >= 400 && p2.status >= 400);

// 5) Sin sesión / CSRF
const u1 = await fetch(`${BASE}/api/v1/contacts`);
const u2 = await fetch(`${BASE}/api/v1/conversations`);
rec("T8", "Sin sesión", "401", `contacts=${u1.status}; conversations=${u2.status}`, u1.status === 401 && u2.status === 401);
const c1 = await fetch(`${BASE}/api/v1/contacts`, { method: "POST", headers: { cookie: A, "content-type": "application/json" }, body: JSON.stringify({ name: "csrf", phone: "+5491100000999" }) });
const c2 = await fetch(`${BASE}/api/v1/contacts`, { method: "POST", headers: { cookie: A, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ name: "csrf", phone: "+5491100000998" }) });
rec("T9", "Escritura con cookie válida sin Origin / Origin ajeno (CSRF)", "403", `sin origin=${c1.status}; origin ajeno=${c2.status}`, c1.status === 403 && c2.status === 403);

// 6) Secretos: ninguna respuesta de A devuelve claves completas
const aiList = await (await req(A, "GET", "/api/v1/ai-connections")).text();
const chList = await (await req(A, "GET", "/api/v1/channels")).text();
const secretLike = /(sk-[A-Za-z0-9-]{12,}|EAA[A-Za-z0-9]{12,}|"apiKey"|"accessToken"|"webhookSecret")/;
rec("T10", "Listados de credenciales no exponen secretos", "Solo pistas (hint)", `ai=${secretLike.test(aiList) ? "EXPONE" : "ok"}; canales=${secretLike.test(chList) ? "EXPONE" : "ok"}`, !secretLike.test(aiList) && !secretLike.test(chList));

// 7) Webhook: firma inválida, clave inexistente
const w1 = await fetch(`${BASE}/api/webhooks/chatwoot/no-existe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
rec("T11", "Webhook con clave inexistente", "404", `status=${w1.status}`, w1.status === 404);

// 8) Fuerza bruta de login (en dev el rate limit de Better Auth está desactivado salvo AUTH_RATE_LIMIT=true)
const codes = [];
for (let i = 0; i < 12; i++) codes.push((await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: "admin@optica.demo.loopchat.test", password: "incorrecta-" + i }) })).status);
// Sin límites activos (dev sin AUTH_RATE_LIMIT) el chequeo se informa pero no hace fallar la corrida
const limitsOn = process.env.AUTH_RATE_LIMIT === "true" || process.env.NODE_ENV === "production";
rec("T12", `12 logins fallidos seguidos (límites ${limitsOn ? "activos" : "desactivados en este entorno"})`, "429 en algún punto", `códigos=${codes.join(",")}`, codes.includes(429) || !limitsOn);

const out = path.resolve(import.meta.dirname, "../../docs/readiness-remediation/evidence");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "http-tenancy-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, counts: Object.fromEntries(Object.entries(listB).map(([k, v]) => [k, v.length])), results }, null, 2));
for (const r of results) console.log(r.verdict.padEnd(5), r.id.padEnd(4), r.check, "→", r.obtained);
if (results.some((r) => r.verdict === "FAIL")) process.exitCode = 1;
