import { expect, type Page } from "@playwright/test";

export const PASSWORD = "demo-loopchat-123";
export const USERS = {
  adminA: "admin@ferreteria.demo.loopchat.test",
  managerA: "manager@ferreteria.demo.loopchat.test",
  agentA: "agente@ferreteria.demo.loopchat.test",
  viewerA: "lectura@ferreteria.demo.loopchat.test",
  adminB: "admin@optica.demo.loopchat.test",
  platform: "plataforma@demo.loopchat.test",
};

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.locator("form[data-ready='true']").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/(dashboard|admin)/);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "sin overflow horizontal global").toBeLessThanOrEqual(1);
}
