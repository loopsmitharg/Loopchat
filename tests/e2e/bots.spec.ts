import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

test("editor visual: crear flujo, validar, publicar y simular sin enviar WhatsApp", async ({ page, request }) => {
  await login(page, USERS.adminA);
  await page.goto("/chatbots");
  await page.getByRole("button", { name: "Nuevo", exact: true }).click();
  await page.getByRole("dialog", { name: "¿Qué tipo de atención querés crear?" }).getByRole("button", { name: /Chatbot individual/ }).click();
  // asistente guiado: función → … → probar → publicar (acá solo se crea el borrador)
  await expect(page.getByRole("heading", { name: "Nuevo chatbot" })).toBeVisible();
  await page.getByLabel("Nombre del bot").fill("Flujo E2E");
  await page.getByLabel("Tipo", { exact: true }).selectOption("flow");
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y probar" }).click();
  await expect(page.getByText("Probalo con el simulador")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Ir a la configuración del bot" }).click();
  await expect(page.getByRole("heading", { name: "Flujo E2E" })).toBeVisible();
  await expect(page.getByText("Flujo válido")).toBeVisible();

  // vista lista (alternativa accesible al lienzo)
  await page.getByRole("button", { name: "Lista" }).click();
  await page.getByRole("button", { name: /Inicio/ }).click();
  await page.getByLabel("Agregar nodo").selectOption("message");
  await expect(page.getByText(/problema/)).toBeVisible(); // mensaje vacío + salida sin conectar
  await page.getByLabel("Texto a enviar").fill("¡Hola {{contact.name}}! Gracias por escribirnos.");
  const target = page.getByLabel(/Destino de la salida Siguiente/).last();
  const finValue = await target.locator("option", { hasText: /^Fin/ }).first().getAttribute("value");
  await target.selectOption(finValue!);
  await expect(page.getByText("Flujo válido")).toBeVisible();
  await expect(page.getByText("Borrador guardado")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Publicar versión" }).click();
  await expect(page.getByText(/Versión 1 publicada/)).toBeVisible();

  const before = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  await page.getByRole("tab", { name: "Probar" }).click();
  await page.getByLabel("Mensajes del cliente (uno por línea)").fill("Hola");
  await page.getByRole("button", { name: "Simular" }).click();
  await expect(page.getByText("¡Hola Cliente de prueba! Gracias por escribirnos.")).toBeVisible();
  const after = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  expect(after).toBe(before); // la simulación no envió nada

  await page.getByRole("tab", { name: "Versiones" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "En uso" })).toContainText("v1");
});

test("conexión de IA: la clave nunca vuelve al navegador", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/configuracion/ia");
  await page.getByLabel("Nombre").fill("Segunda cuenta");
  await page.getByLabel("Modelo por defecto").fill("gpt-4o-mini");
  await page.getByLabel("URL base (opcional)").fill("http://localhost:3012/v1");
  await page.getByLabel("API key").fill("sk-e2e-clave-secreta-9876");
  const responses: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/v1/ai-connections")) responses.push(await r.text().catch(() => ""));
  });
  await page.getByRole("button", { name: "Guardar y probar" }).click();
  await expect(page.getByText("Segunda cuenta")).toBeVisible();
  await expect(page.getByText("••••9876")).toBeVisible();
  expect(responses.join("")).not.toContain("sk-e2e-clave-secreta-9876");
  expect(await page.content()).not.toContain("sk-e2e-clave-secreta-9876");
});
