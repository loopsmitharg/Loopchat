import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

async function axe(page: Page, label: string, problems: string[]) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).exclude(".react-flow__renderer").analyze();
  for (const v of r.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? ""))) problems.push(`${label} → ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
}

test("equipos de chatbots: asistente guiado, editor visual, simulador multiagente sin efectos", async ({ page, request }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  await login(page, USERS.adminA);
  await page.goto("/chatbots");
  await expect(page.getByRole("tab", { name: "Mis chatbots" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Nuevo" }).click();
  const chooser = page.getByRole("dialog", { name: "¿Qué tipo de atención querés crear?" });
  await expect(chooser.getByText("Chatbot individual")).toBeVisible();
  await chooser.getByRole("button", { name: /Equipo de chatbots/ }).click();

  // asistente de 8 pasos
  await expect(page.getByRole("heading", { name: "Nuevo equipo de chatbots" })).toBeVisible();
  await axe(page, "asistente", problems);
  await page.getByLabel("Nombre del equipo").fill("Equipo E2E");
  await page.getByRole("button", { name: "Siguiente" }).click(); // roles
  await expect(page.getByRole("checkbox", { name: /Recepcionista/ })).toBeChecked();
  await page.getByRole("button", { name: "Siguiente" }).click(); // bots
  await page.getByLabel("Nombre del bot Recepcionista").fill("Recepción E2E");
  await page.getByLabel("Nombre del bot Ventas").fill("Ventas E2E");
  await page.getByLabel("Nombre del bot Soporte técnico").fill("Soporte E2E");
  await page.getByRole("button", { name: "Siguiente" }).click(); // IA
  const conn = page.getByLabel("Proveedor de IA para los bots nuevos");
  await conn.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Siguiente" }).click(); // pipelines
  await page.getByRole("button", { name: "Siguiente" }).click(); // derivaciones
  await expect(page.getByText("sin necesidad asociada")).toHaveCount(0);
  await page.getByRole("button", { name: "Siguiente" }).click(); // humano
  await page.getByRole("button", { name: "Siguiente" }).click(); // revisar
  await page.getByRole("button", { name: "Crear equipo" }).click();

  // detalle del equipo: publicado, inactivo, editor con nodos
  await expect(page.getByRole("heading", { name: "Equipo E2E" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Versión publicada: v1")).toBeVisible();
  await expect(page.getByText("Equipo válido")).toBeVisible();
  const canvas = page.getByLabel("Lienzo del equipo");
  await expect(canvas.getByText("Recepción E2E")).toBeVisible();
  await expect(canvas.getByText("Entrada")).toBeVisible();
  await expect(canvas.getByText("Atención humana")).toBeVisible();
  await noHorizontalOverflow(page);
  await axe(page, "editor", problems);

  // vista de lista accesible: seleccionar un bot muestra sus derivaciones
  await page.getByRole("button", { name: "Lista" }).click();
  await page.getByRole("list", { name: "Bots del equipo" }).getByRole("button", { name: /Recepción E2E/ }).click();
  const panel = page.getByLabel("Detalle del elemento seleccionado");
  await expect(panel.getByText("Recepcionista: identifica la necesidad y deriva.")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Ventas E2E/ })).toBeVisible();

  // simulador multiagente: reclamo con precio → soporte; venta → ventas; sin cambios reales
  const before = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  await page.getByRole("tab", { name: "Probar" }).click();
  await page.getByRole("button", { name: "Reclamo con precio" }).click();
  const activity = page.getByLabel("Actividad del equipo");
  await expect(activity).toContainText("Soporte E2E");
  await expect(activity).toContainText("Soporte técnico");
  await expect(activity).toContainText("Recepción E2E");
  await page.getByRole("button", { name: "Venta", exact: true }).click();
  await expect(activity).toContainText("Ventas E2E");
  await expect(activity).toContainText("Recepción E2E");
  await page.getByLabel("Mensaje del cliente").fill("quiero hablar con una persona");
  await page.getByRole("button", { name: "Enviar mensaje de prueba" }).click();
  await expect(activity).toContainText(/persona/);
  await noHorizontalOverflow(page);
  await axe(page, "simulador", problems);
  const after = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  expect(after).toBe(before);

  // configuración: reglas y automatizaciones; versiones
  await page.getByRole("tab", { name: "Configuración" }).click();
  await expect(page.getByText("Reglas de derivación")).toBeVisible();
  await page.getByRole("button", { name: "Agregar automatización" }).click();
  await expect(page.getByLabel("Evento")).toBeVisible();
  await axe(page, "configuración", problems);
  await page.getByRole("tab", { name: "Equipo" }).click();
  await expect(page.getByText("Borrador guardado")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "Versiones" }).click();
  await expect(page.getByText("En uso")).toBeVisible();

  // listado de equipos
  await page.goto("/chatbots?tab=equipos");
  await expect(page.getByRole("link", { name: "Equipo E2E" })).toBeVisible();
  // el bot nuevo tiene la sección Pipeline asociado
  await page.goto("/chatbots");
  await page.getByRole("link", { name: "Ventas E2E" }).click();
  await page.getByRole("tab", { name: "Configuración" }).click();
  await page.getByRole("button", { name: "Pipeline asociado", exact: true }).click();
  await expect(page.getByText("¿Cuándo puede crear una oportunidad?")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Solo con intención de compra/ })).toBeChecked();
  await noHorizontalOverflow(page);
  await axe(page, "pipeline asociado", problems);
  expect(problems, problems.join("\n")).toEqual([]);
});
