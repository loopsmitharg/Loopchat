// Captura evidencia visual (1440/768/390) de las vistas principales con datos DEMO.
// Requiere app en BASE (default http://localhost:3000) con db:seed:demo-sim aplicado.
// Uso: node scripts/capture-evidence.mjs   (PLAYWRIGHT_CHROMIUM_EXECUTABLE opcional)
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "docs/evidence";
const PASS = process.env.DEMO_PASSWORD ?? "demo-loopchat-123";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator("form[data-ready='true']").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASS);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/dashboard|admin/);
  return { ctx, page };
}

async function shoot(page, name, path, widths = [1440, 768, 390], prepare) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 });
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    if (prepare) await prepare(page, w);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}/${name}-${w}.jpg`, type: "jpeg", quality: 72 });
    console.log(`${name}-${w}: overflowX=${overflow > 1}`);
  }
}

const { page } = await session("admin@ferreteria.demo.loopchat.test");
const origin = { origin: BASE };
// bot de flujo de ejemplo para la evidencia del editor
const bots = await (await page.request.get(`${BASE}/api/v1/bots`)).json();
let flow = bots.find((b) => b.name === "Flujo de bienvenida (DEMO)");
if (!flow) {
  flow = await (await page.request.post(`${BASE}/api/v1/bots`, { headers: origin, data: { name: "Flujo de bienvenida (DEMO)", mode: "flow", instructions: "" } })).json();
  const detail = await (await page.request.get(`${BASE}/api/v1/bots/${flow.id}`)).json();
  const graph = {
    nodes: [
      { id: "start", type: "start", position: { x: 260, y: 0 }, data: {} },
      { id: "cond", type: "condition", position: { x: 260, y: 130 }, data: { source: "message", operator: "contains_any", value: "precio, presupuesto, cuánto" } },
      { id: "msg", type: "message", position: { x: 0, y: 290 }, data: { text: "¡Hola {{contact.name}}! Te paso los precios en un momento." } },
      { id: "opp", type: "opportunity", position: { x: 0, y: 440 }, data: { action: "create_or_update", stageId: null, title: "Pidió presupuesto" } },
      { id: "ai", type: "ai", position: { x: 520, y: 290 }, data: { sendReply: true, tools: ["classify", "use_knowledge", "handoff"] } },
      { id: "wait", type: "wait", position: { x: 0, y: 590 }, data: { timeoutMinutes: 60 } },
      { id: "hand", type: "handoff", position: { x: 640, y: 470 }, data: { reason: "El cliente pidió una persona" } },
      { id: "end", type: "end", position: { x: 300, y: 740 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", sourceHandle: "out" },
      { id: "e2", source: "cond", target: "msg", sourceHandle: "true" },
      { id: "e3", source: "cond", target: "ai", sourceHandle: "false" },
      { id: "e4", source: "msg", target: "opp", sourceHandle: "out" },
      { id: "e5", source: "opp", target: "wait", sourceHandle: "out" },
      { id: "e6", source: "wait", target: "end", sourceHandle: "reply" },
      { id: "e7", source: "ai", target: "end", sourceHandle: "out" },
      { id: "e8", source: "ai", target: "hand", sourceHandle: "handoff" },
    ],
  };
  await page.request.put(`${BASE}/api/v1/bots/${flow.id}/draft`, { headers: origin, data: { graph, revision: detail.bot.draftRevision } });
}
const convs = await (await page.request.get(`${BASE}/api/v1/conversations?status=all`)).json();
const lucia = convs.items.find((c) => c.contactName.startsWith("Lucía"));

await shoot(page, "dashboard", "/dashboard");
await shoot(page, "inbox", `/conversaciones?c=${lucia.id}`);
await shoot(page, "inbox-list", "/conversaciones", [390]);
await shoot(page, "pipeline", "/pipeline");
await shoot(page, "contactos", "/contactos", [1440, 390]);
await shoot(page, "chatbot-editor", `/chatbots/${flow.id}`, [1440, 390]);
await shoot(page, "config-whatsapp", "/configuracion/whatsapp", [1440, 390]);
await shoot(page, "config-ia", "/configuracion/ia", [1440]);
await shoot(page, "plan", "/configuracion/plan", [1440]);
const admin = await session("plataforma@demo.loopchat.test");
await shoot(admin.page, "admin", "/admin", [1440, 390]);
await browser.close();
