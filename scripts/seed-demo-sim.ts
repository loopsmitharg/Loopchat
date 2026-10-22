import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db";
import { chatwootAccounts, memberships, tenants, user } from "../src/server/db/schema";
import type { Ctx } from "../src/server/authz/context";
import { provisionChatwootAccount } from "../src/server/services/chatwoot-provisioning";
import { connectWhatsapp, listChannels } from "../src/server/services/channels";
import { createAiConnection, listAiConnections, testAiConnection } from "../src/server/services/ai-connections";
import { createBot, listBots, publishBot, setBotStatus } from "../src/server/services/bots";
import { addFaq, listKnowledge } from "../src/server/services/knowledge";
import { seedDemoCatalog } from "./lib/demo-catalog";

/**
 * Conecta las empresas DEMO a los SIMULADORES locales (Chatwoot/Meta/IA) y genera
 * conversaciones DEMO. Requiere: npm run sim:chatwoot, npm run sim:ai y la app corriendo.
 * Nunca usar contra servicios reales.
 */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Solo para desarrollo");
  if (!process.env.CHATWOOT_BASE_URL?.includes("localhost")) throw new Error("CHATWOOT_BASE_URL debe apuntar al simulador local");
  const db = getDb();
  const sim = process.env.CHATWOOT_BASE_URL;
  for (const [slug, adminEmail, phone] of [
    ["demo-ferreteria-norte", "admin@ferreteria.demo.loopchat.test", "+5491150000001"],
    ["demo-optica-sur", "admin@optica.demo.loopchat.test", "+5491150000002"],
  ] as const) {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
    const u = await db.query.user.findFirst({ where: eq(user.email, adminEmail) });
    if (!t || !u) throw new Error("Corré antes npm run db:seed:demo");
    const m = await db.query.memberships.findFirst({ where: eq(memberships.userId, u.id) });
    const ctx: Ctx = { tenantId: t.id, actor: { kind: "user", userId: u.id, role: m!.role, name: u.name } };
    await provisionChatwootAccount(t.id, null);
    if ((await listChannels(ctx)).length === 0) {
      const suffix = slug === "demo-optica-sur" ? "2" : "1";
      await connectWhatsapp(ctx, { displayName: "Ventas (DEMO)", phoneNumber: phone, wabaId: `10000000${suffix}`, phoneNumberId: `20000000${suffix}`, accessToken: "EAA-demo-token-solo-simulador-000000", billingOwnerConfirmed: true });
    }
    if ((await listAiConnections(ctx)).length === 0) {
      const c = await createAiConnection(ctx, { provider: "openai_compatible", label: "Simulador IA (DEMO)", apiKey: `sk-demo-${suffixFor(slug)}-0000`, baseUrl: "http://localhost:3012/v1", defaultModel: "gpt-4o-mini" });
      await testAiConnection(ctx, c.id);
    }
    if ((await listKnowledge(ctx)).length === 0) {
      await addFaq(ctx, { question: "¿Hacen envíos a domicilio?", answer: "Sí, envíos en CABA y GBA en 24/48 h (DEMO)." });
      await addFaq(ctx, { question: "¿Cuál es el horario de atención?", answer: "Lunes a viernes de 9 a 18 y sábados de 9 a 13 (DEMO)." });
    }
    if ((await listBots(ctx)).length === 0) {
      const conn = (await listAiConnections(ctx))[0];
      const b = await createBot(ctx, { name: "Asistente de ventas (DEMO)", mode: "instructions", aiConnectionId: conn.id, instructions: "Somos una empresa DEMO. Respondé consultas de precios y derivá reclamos a una persona.", allowedTools: ["classify", "use_knowledge", "handoff", "create_opportunity", "update_stage", "create_task"], handoffKeywords: ["asesor", "humano"] });
      await publishBot(ctx, b.id);
      await setBotStatus(ctx, b.id, "active");
    }
    await seedDemoCatalog({ configureBot: true });
    const mapping = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, t.id) });
    const msgs =
      slug === "demo-ferreteria-norte"
        ? [
            ["+5491160001001", "Lucía Fernández (DEMO)", "Hola! Cuál es el precio del taladro percutor?"],
            ["+5491160001002", "Martín Acosta (DEMO)", "Quiero hablar con un humano por un reclamo"],
            ["+5491160001003", "Sofía Ramírez (DEMO)", "Hacen envíos a domicilio?"],
            ["+5491160001004", "Diego Herrera (DEMO)", "Buen día, necesito 20 bolsas de cemento, me pasan presupuesto?"],
          ]
        : [["+5491160002001", "Valentina Ruiz (DEMO)", "Hola, tienen turnos para control de vista?"]];
    for (const [ph, name, content] of msgs) {
      const r = await fetch(`${sim}/__sim/incoming`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: mapping!.chatwootAccountId, phone: ph, name, content }) });
      if (!r.ok) throw new Error(`El simulador rechazó el mensaje DEMO (${r.status}): base y simulador no coinciden. Usá reiniciar-demo-desde-cero.cmd`);
    }
  }
  console.log("Empresas DEMO conectadas a los simuladores y conversaciones DEMO generadas.");
  await getPool().end();
}
function suffixFor(slug: string) {
  return slug === "demo-optica-sur" ? "optica" : "ferreteria";
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
