import { expect, test } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

test("mover oportunidad con el selector accesible (sin arrastrar) y persiste al recargar", async ({ page }) => {
  await login(page, USERS.managerA);
  await page.goto("/pipeline");
  const card = page.locator("article").filter({ hasText: "Consulta de Sofía" });
  await card.getByLabel(/Mover .* a otra etapa/).selectOption({ label: "Seguimiento" });
  await expect(page.getByText(/movida a Seguimiento/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Etapa Seguimiento" }).getByText("Consulta de Sofía")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("detalle: editar importe, agregar tarea y ver historial", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/pipeline");
  await page.getByRole("button", { name: /^Consulta de Diego/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Importe estimado").fill("150000");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await dialog.getByLabel("Nueva tarea").fill("Enviar presupuesto formal");
  await dialog.getByRole("button", { name: "Agregar" }).click();
  await expect(dialog.getByText("Enviar presupuesto formal")).toBeVisible();
  await expect(dialog.getByText("Importe").first()).toBeVisible();
});

test("solo lectura no ve controles de mover", async ({ page }) => {
  await login(page, USERS.viewerA);
  await page.goto("/pipeline");
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page.getByLabel(/Mover .* a otra etapa/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nueva oportunidad" })).toHaveCount(0);
});
