import { expect, test } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

test("bandeja: ver respuesta del bot, responder por WhatsApp (una sola vez) y dejar nota interna que nunca sale", async ({ page, request }) => {
  await login(page, USERS.adminA);
  await page.goto("/conversaciones");
  await page.getByRole("button", { name: /Lucía Fernández/ }).click();
  await expect(page.getByText("El taladro percutor cuesta $85.000")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar bot" })).toBeVisible(); // la atiende el bot

  const box = page.getByLabel("Mensaje para el cliente");
  await box.fill("Hola Lucía, te lo reservo hasta mañana.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.locator("ol[aria-label='Mensajes']").getByText("Hola Lucía, te lo reservo hasta mañana.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reanudar bot" })).toBeVisible(); // tomó control: el bot dejó de atender

  await page.getByRole("tab", { name: "Nota interna" }).click();
  await page.getByLabel("Nota interna").fill("Cliente pidió factura A");
  await page.getByRole("button", { name: "Guardar nota" }).click();
  await expect(page.getByRole("complementary").getByText("Cliente pidió factura A")).toBeVisible();

  const state = await (await request.get("http://localhost:3011/__sim/state")).json();
  const msgs = state.accounts.flatMap((a: { conversations: { messages: { content: string; message_type: number }[] }[] }) => a.conversations.flatMap((c) => c.messages));
  expect(msgs.filter((m: { content: string }) => m.content === "Hola Lucía, te lo reservo hasta mañana.")).toHaveLength(1);
  expect(msgs.some((m: { content: string }) => (m.content ?? "").includes("factura A"))).toBe(false);
  await noHorizontalOverflow(page);
});

test("mensaje entrante nuevo aparece por actualización periódica", async ({ page, request }) => {
  await login(page, USERS.adminA);
  await page.goto("/conversaciones");
  const state = await (await request.get("http://localhost:3011/__sim/state")).json();
  const accountId = state.accounts.find((a: { name: string }) => a.name.startsWith("DEMO Ferretería")).id;
  await request.post("http://localhost:3011/__sim/incoming", { data: { accountId, phone: "+5491160009999", name: "Nuevo Cliente E2E", content: "Hola, quiero hablar con un asesor" } });
  await expect(page.getByRole("button", { name: /Nuevo Cliente E2E/ })).toBeVisible({ timeout: 20_000 });
});

test("aislamiento: la empresa B no puede abrir una conversación de A cambiando el ID", async ({ page }) => {
  await login(page, USERS.adminA);
  await page.goto("/conversaciones");
  await page.getByRole("button", { name: /Lucía Fernández/ }).click();
  await expect(page).toHaveURL(/c=/);
  const id = new URL(page.url()).searchParams.get("c")!;
  await page.context().clearCookies();
  await login(page, USERS.adminB);
  const res = await page.request.get(`/api/v1/conversations/${id}`);
  expect(res.status()).toBe(404);
  const body = await res.text();
  expect(body).not.toContain("Lucía");
  await page.goto(`/conversaciones?c=${id}`);
  await expect(page.getByText(/no encontrada/i)).toBeVisible();
  // ni siquiera puede escribir
  const send = await page.request.post(`/api/v1/conversations/${id}/messages`, { data: { text: "hack", idempotencyKey: "e2e-hack-123" }, headers: { origin: page.url().split("/conversaciones")[0] } });
  expect(send.status()).toBe(404);
});

test("rol solo lectura: ve la conversación pero no puede responder", async ({ page }) => {
  await login(page, USERS.viewerA);
  await page.goto("/conversaciones");
  await page.getByRole("button", { name: /Sofía Ramírez/ }).click();
  await expect(page.getByText("Tu rol no permite responder mensajes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar bot" })).toHaveCount(0);
});

test("CSRF: una mutación desde otro origen se rechaza", async ({ page }) => {
  await login(page, USERS.adminA);
  const res = await page.request.post("/api/v1/contacts", { data: { name: "csrf" }, headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});
