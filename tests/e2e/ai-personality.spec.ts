import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, noHorizontalOverflow, USERS } from "./helpers";

async function axe(page: Page, label: string, problems: string[]) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  for (const v of r.violations.filter((x) => ["serious", "critical"].includes(x.impact ?? ""))) problems.push(`${label} → ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
}

test("empresa: objetivo, reglas obligatorias heredadas y personalidad de marca", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  await login(page, USERS.adminA);
  await page.goto("/configuracion/identidad-ia");
  await expect(page.getByRole("heading", { name: "Identidad y objetivos de IA" })).toBeVisible();
  await page.getByRole("radio", { name: "Aumentar las ventas" }).check();
  await page.getByLabel("Explicalo con tus palabras").fill("Aumentar las ventas con asesoramiento profesional, sin presionar ni inventar información comercial.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Guardado\. Los bots lo aplican/)).toBeVisible();
  await axe(page, "objetivo", problems);
  await page.getByRole("tab", { name: "Reglas generales" }).click();
  await page.getByRole("button", { name: "Agregar reglas sugeridas" }).click();
  await expect(page.getByText("No inventar precios: informar solo los precios cargados en el catálogo o el conocimiento.")).toBeVisible();
  await expect(page.getByText(/La heredan \d+ bot/).first()).toBeVisible();
  await axe(page, "reglas", problems);
  await page.getByRole("tab", { name: "Personalidad de marca" }).click();
  await page.getByLabel("Forma de saludar").fill("¡Hola! Gracias por escribir a Ferretería Norte.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Guardado\./)).toBeVisible();
  await page.getByRole("tab", { name: /Bots/ }).click();
  await expect(page.getByText(/Política anterior · publicar para aplicar/).first()).toBeVisible();
  await noHorizontalOverflow(page);
  expect(problems, problems.join("\n")).toEqual([]);
});

test("bot: personalidad visual que cambia las instrucciones efectivas, reglas heredadas, simulador y comparación", async ({ page, request }) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  await login(page, USERS.adminA);
  await page.goto("/chatbots");
  await page.getByRole("link", { name: /Asistente de ventas \(DEMO\)/ }).first().click();
  await page.getByRole("tab", { name: "Configuración" }).click();
  await page.getByRole("button", { name: "Personalidad y comportamiento", exact: true }).click();
  await page.getByRole("radio", { name: "Muy formal" }).check();
  // vista previa orientativa actualizada al instante
  await expect(page.getByText("Ejemplo orientativo · no generado por IA")).toBeVisible();
  await expect(page.getByText(/ayudarlo/).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Serio" }).check();
  await page.getByRole("checkbox", { name: "Entusiasta" }).check();
  await expect(page.getByText(/"Serio" y "Entusiasta" se contradicen/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Guardado\. Publicá/)).toBeVisible();
  await axe(page, "personalidad", problems);
  await noHorizontalOverflow(page);

  await page.getByRole("button", { name: "Reglas de comportamiento", exact: true }).click();
  await expect(page.getByText("Obligatoria · bloqueada").first()).toBeVisible();
  await axe(page, "reglas", problems);

  await page.getByRole("button", { name: "Instrucciones efectivas", exact: true }).click();
  const eff = page.getByRole("list").filter({ hasText: "1 · Plataforma (seguridad)" });
  await expect(eff).toContainText("2 · Obligatorias de la empresa");
  await expect(eff).toContainText("Muy formal");
  await page.getByRole("button", { name: "Versión publicada (en uso)" }).click();
  await expect(page.getByText(/política de la empresa: solo aplica las reglas obligatorias|v\d+ · motor/).first()).toBeVisible();
  await axe(page, "instrucciones efectivas", problems);

  // simulador: refleja la personalidad (IA simulada indica el estilo recibido) y no cambia nada real
  const before = JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json());
  await page.getByRole("tab", { name: "Probar" }).click();
  await page.getByRole("button", { name: "Interesado en comprar" }).click();
  await expect(page.getByText(/IA simulada · .*formal/).first()).toBeVisible();
  await expect(page.getByText(/Configuración probada: Borrador/)).toBeVisible();
  expect(JSON.stringify(await (await request.get("http://localhost:3011/__sim/state")).json())).toBe(before);

  // versiones: qué cambió entre lo publicado y el borrador
  await page.getByRole("tab", { name: "Versiones" }).click();
  await page.getByLabel("Versión B").selectOption("draft");
  await page.getByRole("button", { name: "Ver qué cambió" }).click();
  await expect(page.getByRole("cell", { name: "Personalidad: formality" })).toBeVisible();
  expect(problems, problems.join("\n")).toEqual([]);
});

test("asistente de creación: recepcionista en 8 pasos, probar y publicar", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, USERS.adminA);
  await page.goto("/chatbots/nuevo");
  await page.getByRole("radio", { name: /Recepcionista/ }).check();
  await page.getByLabel("Nombre del bot").fill("Recepción guiada E2E");
  await page.getByRole("button", { name: "Siguiente" }).click(); // objetivo
  await expect(page.getByRole("checkbox", { name: "Identificar la necesidad del cliente" })).toBeChecked();
  await page.getByRole("button", { name: "Siguiente" }).click(); // cómo habla
  await page.getByRole("button", { name: "Recepcionista cordial" }).click();
  await expect(page.getByText(/Bienvenido/).first()).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click(); // qué sabe
  await page.getByRole("button", { name: "Siguiente" }).click(); // qué puede hacer
  await expect(page.getByText("(no para recepcionista)").first()).toBeVisible();
  await page.getByLabel("Proveedor de IA").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Siguiente" }).click(); // cuándo deriva
  await page.getByRole("button", { name: "Guardar y probar" }).click();
  await page.getByRole("button", { name: "Intervención humana" }).click();
  await expect(page.getByRole("table")).toContainText(/Palabra clave/);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Validar y publicar" }).click();
  await expect(page.getByText("Versión 1 publicada.")).toBeVisible();
  await page.getByRole("button", { name: "Ir a la configuración del bot" }).click();
  await expect(page.getByRole("heading", { name: "Recepción guiada E2E" })).toBeVisible();
});
