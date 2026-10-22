import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

/** WCAG 2.1 AA automatizado (axe-core): sin violaciones graves o críticas en las vistas principales. */
const PAGES = ["/dashboard", "/conversaciones", "/pipeline", "/contactos", "/tareas", "/chatbots", "/configuracion/whatsapp", "/configuracion/ia", "/configuracion/equipo"];

test("login accesible", async ({ page }) => {
  await page.goto("/login");
  await page.locator("form[data-ready='true']").waitFor();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("vistas principales sin violaciones graves", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, USERS.adminA);
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).exclude(".react-flow__attribution").analyze();
    for (const v of r.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? ""))) problems.push(`${path} → ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
  }
  // conversación abierta
  await page.goto("/conversaciones");
  await page.getByRole("button", { name: /Sofía Ramírez/ }).click();
  await page.locator("ol[aria-label='Mensajes']").waitFor();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  for (const v of r.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? ""))) problems.push(`conversación → ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
  expect(problems).toEqual([]);
});
