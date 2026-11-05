import { expect, test } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

test("fuera de la ventana de 24 h: el agente reabre la conversación con una plantilla aprobada desde Loopchat", async ({ page, request }) => {
  const state = await (await request.get("http://localhost:3011/__sim/state")).json();
  const accountId = state.accounts.find((a: { name: string }) => a.name.startsWith("DEMO Ferretería")).id;
  // mensaje del cliente de hace 30 h (ventana cerrada)
  await request.post("http://localhost:3011/__sim/incoming", { data: { accountId, phone: "+5491160008888", name: "Cliente Plantilla E2E", content: "Hola, consulta vieja", ageSeconds: 30 * 3600 } });

  await login(page, USERS.adminA);
  await page.goto("/conversaciones");
  await page.getByRole("button", { name: /Cliente Plantilla E2E/ }).click({ timeout: 20_000 });
  await expect(page.getByText(/Pasaron más de 24 h/).first()).toBeVisible();
  await page.getByRole("button", { name: "Enviar plantilla" }).click();

  const dialog = page.getByRole("dialog", { name: "Enviar plantilla de WhatsApp" });
  await expect(dialog.getByLabel("Plantilla", { exact: true })).toHaveValue("seguimiento_consulta|es_AR");
  await expect(dialog.getByRole("button", { name: "Enviar plantilla" })).toBeDisabled();
  await dialog.getByLabel("Dato {{1}}").fill("Ana");
  await dialog.getByLabel("Dato {{2}}").fill("el taladro percutor");
  await expect(dialog.getByText("Hola Ana, te escribimos por tu consulta sobre el taladro percutor. ¿Seguimos por acá?")).toBeVisible();
  await noHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "Enviar plantilla" }).click();
  await expect(dialog).toBeHidden();

  const after = await (await request.get("http://localhost:3011/__sim/state")).json();
  const sent = after.accounts.flatMap((a: { conversations: { messages: { content: string; message_type: number; status: string }[] }[] }) => a.conversations.flatMap((c) => c.messages)).filter((m: { message_type: number; content: string }) => m.message_type === 3 && m.content?.startsWith("Hola Ana"));
  expect(sent).toHaveLength(1);
  expect(sent[0].status).toBe("sent");
});
