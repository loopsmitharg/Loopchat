import { expect, test } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

test("móvil: bandeja → conversación → ficha, responder y volver", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/conversaciones");
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: /Diego Herrera/ }).click();
  await expect(page.getByRole("button", { name: "Volver a la lista" })).toBeVisible();
  await page.getByLabel("Mensaje para el cliente").fill("Te paso el presupuesto en un rato.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.locator("ol[aria-label='Mensajes']").getByText("Te paso el presupuesto en un rato.")).toBeVisible();
  await page.getByRole("button", { name: "Ver ficha del contacto y oportunidades" }).click();
  await expect(page.getByRole("dialog", { name: "Ficha y oportunidades" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar ficha" }).last().click();
  await page.getByRole("button", { name: "Volver a la lista" }).click();
  await expect(page.getByRole("tablist", { name: "Filtrar por responsable" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("móvil: menú lateral y páginas sin overflow", async ({ page }) => {
  await login(page, USERS.adminA);
  for (const path of ["/dashboard", "/pipeline", "/contactos", "/tareas", "/chatbots", "/configuracion/whatsapp"]) {
    await page.goto(path);
    await noHorizontalOverflow(page);
  }
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("dialog", { name: "Menú" }).getByRole("link", { name: "Contactos" }).click();
  await expect(page).toHaveURL(/contactos/);
});

test("móvil: configuración del bot por secciones y simulador sin overflow", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/chatbots");
  await page.getByRole("link", { name: /Asistente de ventas \(DEMO\)/ }).first().click();
  await page.getByRole("tab", { name: "Configuración" }).click();
  for (const section of ["Personalidad y comportamiento", "Reglas de comportamiento", "Derivación humana", "Productos", "Herramientas y acciones", "Datos comerciales", "Instrucciones efectivas"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await noHorizontalOverflow(page);
  }
  await page.getByRole("tab", { name: "Probar" }).click();
  await page.getByRole("button", { name: "Insulto (es)" }).click();
  await expect(page.getByRole("table")).toContainText("No llamada");
  await noHorizontalOverflow(page);
});

test("móvil: identidad y objetivos de IA y asistente de creación sin overflow", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/configuracion/identidad-ia");
  await expect(page.getByRole("heading", { name: "Identidad y objetivos de IA" })).toBeVisible();
  for (const tab of ["Objetivo", "Identidad", "Reglas generales", "Personalidad de marca"]) {
    await page.getByRole("tab", { name: tab }).click();
    await noHorizontalOverflow(page);
  }
  await page.goto("/chatbots/nuevo");
  await expect(page.getByRole("heading", { name: "Nuevo chatbot" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Así hablaría")).toBeVisible();
  await noHorizontalOverflow(page);
});
