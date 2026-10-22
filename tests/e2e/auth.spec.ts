import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

test("ruta protegida redirige a login; credenciales inválidas muestran error", async ({ page }) => {
  await page.goto("/conversaciones");
  await expect(page).toHaveURL(/\/login/);
  await page.locator("form[data-ready='true']").waitFor();
  await page.getByLabel("Email").fill(USERS.adminA);
  await page.getByLabel("Contraseña").fill("incorrecta-123456");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
});

test("login, navegación por teclado y logout", async ({ page }) => {
  await login(page, USERS.adminA);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.getByRole("button", { name: /Ana/ }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("alta de empresa por Loop Smiths → invitación → el admin crea su cuenta y entra", async ({ page, browser }) => {
  await login(page, USERS.platform);
  await expect(page.getByRole("heading", { name: "Empresas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nueva empresa" }).click();
  const slug = `e2e-${Date.now().toString(36)}`;
  await page.getByLabel("Nombre").fill("Librería E2E");
  await page.getByLabel("Identificador").fill(slug);
  await page.getByLabel("Email del administrador de la empresa").fill(`${slug}@e2e.test`);
  await page.getByRole("button", { name: "Crear e invitar" }).click();
  const url = await page.locator("code").first().textContent();
  expect(url).toContain("/invitacion/");
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url!.replace(/^https?:\/\/[^/]+/, ""));
  await expect(p2.getByRole("heading", { name: /Sumate a Librería E2E/ })).toBeVisible();
  await p2.getByLabel("Tu nombre").fill("Dueña E2E");
  await p2.getByLabel("Contraseña", { exact: true }).fill("clave-segura-e2e-1");
  await p2.getByLabel("Repetir contraseña").fill("clave-segura-e2e-1");
  await p2.getByRole("button", { name: "Crear cuenta y entrar" }).click();
  await expect(p2).toHaveURL(/\/dashboard/);
  await expect(p2.getByText("Librería E2E")).toBeVisible();
  await ctx.close();
});
