import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function openDemoBot(page: Page) {
  await page.goto("/chatbots");
  await page.getByRole("link", { name: /Asistente de ventas \(DEMO\)/ }).first().click();
  await expect(page.getByRole("heading", { name: "Asistente de ventas (DEMO)" })).toBeVisible();
  await page.getByRole("tab", { name: "Configuración" }).click();
}

test("módulo de bots: derivación por insultos, catálogo, publicación y simulador sin efectos", async ({ page, request }) => {
  test.setTimeout(120_000);
  await login(page, USERS.adminA);
  await openDemoBot(page);

  // Derivación humana: detección local activada por defecto, sin consumir IA
  await page.getByRole("button", { name: "Derivación humana" }).click();
  await expect(page.getByRole("switch", { name: /Derivar automáticamente ante insultos/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("No consume tu API de IA")).toBeVisible();

  // Productos: alta sin precio ni stock (opcionales), con foto validada, asociada al bot
  await page.getByRole("button", { name: "Productos", exact: true }).click();
  const catalogSwitch = page.getByRole("switch", { name: "Consultar el catálogo de productos" });
  if ((await catalogSwitch.getAttribute("aria-checked")) !== "true") {
    await catalogSwitch.click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/Guardado\. Publicá/)).toBeVisible();
  }
  await expect(catalogSwitch).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Nuevo producto" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await dialog.getByLabel("Título *").fill("Amoladora angular E2E");
  await dialog.getByLabel("Descripción *").fill("115 mm, 820 W, disco incluido.");
  await dialog.getByLabel("Elegir foto").setInputFiles({ name: "amoladora.png", mimeType: "image/png", buffer: PNG });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Amoladora angular E2E" });
  await expect(row).toContainText("Precio sin cargar");
  await expect(row).toContainText("Stock sin especificar");
  await expect(row.locator("img")).toHaveCount(1);
  await row.getByLabel("Usa este bot").check();
  await expect(page.getByText(/Producto asociado/)).toBeVisible();

  // cambios guardados sin publicar → publicar
  await expect(page.getByText("Hay cambios guardados sin publicar")).toBeVisible();
  await page.getByRole("button", { name: "Publicar ahora" }).click();
  await expect(page.getByText(/Versión \d+ publicada/)).toBeVisible();
  await expect(page.getByText("Hay cambios guardados sin publicar")).toHaveCount(0);

  // Simulador: casos sin efectos reales
  const before = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  await page.getByRole("tab", { name: "Probar" }).click();
  await page.getByRole("button", { name: "Insulto (es)" }).click();
  const summary = page.getByRole("table");
  await expect(summary).toContainText("No llamada");
  await expect(summary).toContainText("Insulto o agresión detectada (sin IA)");
  await page.getByRole("button", { name: "Producto sin precio" }).click();
  await expect(page.getByText(/Amoladora angular.*no tengo el precio cargado/).first()).toBeVisible();
  await page.getByRole("button", { name: "Acción no autorizada" }).click();
  await expect(page.getByText(/Acción bloqueada: update_stage/)).toBeVisible();
  await page.getByRole("button", { name: "Falso positivo" }).click();
  await expect(summary).toContainText("Llamada");
  await expect(summary).not.toContainText("Insulto");
  const after = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  expect(after).toBe(before);
});

test("configuración del bot accesible y sin overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, USERS.adminA);
  await openDemoBot(page);
  const problems: string[] = [];
  for (const section of ["Identidad", "Objetivos", "Personalidad y comportamiento", "Reglas de comportamiento", "Conocimiento", "Productos", "Herramientas y acciones", "Derivación humana", "Horarios y reglas", "Datos comerciales", "Transferencias", "Operación", "Instrucciones efectivas", "Pipeline asociado"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await noHorizontalOverflow(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    for (const v of r.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? ""))) problems.push(`${section} → ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
  }
  expect(problems).toEqual([]);
});
