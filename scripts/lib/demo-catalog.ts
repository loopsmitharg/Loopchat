import { and, eq } from "drizzle-orm";
import { db } from "../../src/server/db";
import { bots, leadFields, memberships, products, tenants, user } from "../../src/server/db/schema";
import type { Ctx } from "../../src/server/authz/context";
import { createProduct, setBotProducts } from "../../src/server/services/products";
import { createLeadField, slugKey } from "../../src/server/services/lead-fields";
import { publishBot, updateBotSettings } from "../../src/server/services/bots";

/**
 * Datos DEMO del módulo de bots (idempotente; solo empresas DEMO): catálogo de productos,
 * datos comerciales y (solo en una demo nueva) configuración del asistente DEMO.
 * Algunos productos van sin precio o sin stock a propósito, para ver que el bot no los inventa.
 */
const CATALOG: Record<string, { title: string; description: string; price?: number; stock?: number }[]> = {
  "demo-ferreteria-norte": [
    { title: "Taladro percutor 13 mm 750 W (DEMO)", description: "Mandril de 13 mm, 750 W, velocidad variable y reversa. Ideal para hormigón, madera y metal. Incluye maletín.", price: 85000, stock: 4 },
    { title: "Amoladora angular 115 mm 820 W (DEMO)", description: "Disco de 115 mm, 820 W, empuñadura lateral. Para cortar y desbastar metal y cerámica." },
    { title: "Bolsa de cemento 25 kg (DEMO)", description: "Cemento portland normal, bolsa de 25 kg. Envíos en CABA y GBA.", price: 9800, stock: 120 },
    { title: "Burro de arranque Fiat 147 (DEMO)", description: "Motor de arranque reacondicionado compatible con Fiat 147 / Spazio.", price: 120000, stock: 0 },
    { title: "Pintura látex interior 20 L (DEMO)", description: "Látex mate lavable para interiores, blanco, rinde hasta 12 m² por litro.", price: 64000 },
  ],
  "demo-optica-sur": [
    { title: "Anteojos de sol polarizados (DEMO)", description: "Lentes polarizados con filtro UV400, armazón liviano.", price: 45000, stock: 6 },
    { title: "Control de vista (DEMO)", description: "Turno con optometrista, duración aproximada 30 minutos." },
  ],
};
const FIELDS = [
  { label: "Producto buscado", required: true },
  { label: "Cantidad", type: "number" as const, required: true },
  { label: "Urgencia", type: "choice" as const, options: ["Hoy", "Esta semana", "Sin apuro"], required: false },
  { label: "Ubicación", required: false },
];

export async function seedDemoCatalog(opts: { configureBot: boolean }) {
  for (const [slug, items] of Object.entries(CATALOG)) {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
    if (!t) continue;
    const adminEmail = slug === "demo-optica-sur" ? "admin@optica.demo.loopchat.test" : "admin@ferreteria.demo.loopchat.test";
    const u = await db.query.user.findFirst({ where: eq(user.email, adminEmail) });
    const m = u ? await db.query.memberships.findFirst({ where: and(eq(memberships.userId, u.id), eq(memberships.tenantId, t.id)) }) : null;
    if (!u || !m) continue;
    const ctx: Ctx = { tenantId: t.id, actor: { kind: "user", userId: u.id, role: m.role, name: u.name } };

    const existing = await db.select({ id: products.id }).from(products).where(eq(products.tenantId, t.id));
    const created = existing.length ? [] : await Promise.all(items.map((p) => createProduct(ctx, { title: p.title, description: p.description, price: p.price ?? null, stock: p.stock ?? null })));
    const fields = await db.select({ key: leadFields.key }).from(leadFields).where(eq(leadFields.tenantId, t.id));
    if (!fields.length) for (const f of FIELDS) await createLeadField(ctx, { label: f.label, type: f.type ?? "text", options: f.options ?? [] });

    const bot = await db.query.bots.findFirst({ where: and(eq(bots.tenantId, t.id), eq(bots.name, "Asistente de ventas (DEMO)")) });
    // solo si el bot DEMO nunca se configuró: no se pisan cambios del usuario
    if (opts.configureBot && bot && Object.keys((bot.config ?? {}) as object).length === 0) {
      const keys = (await db.select({ key: leadFields.key }).from(leadFields).where(eq(leadFields.tenantId, t.id))).map((r) => r.key);
      await updateBotSettings(ctx, bot.id, {
        allowedTools: [...new Set([...(bot.allowedTools as string[]), "use_catalog", "collect_data"])] as never,
        config: {
          handoff: { transferMessage: "Voy a derivar tu conversación a una persona de nuestro equipo." },
          objectives: { fields: FIELDS.map((f) => ({ key: slugKey(f.label), required: f.required })).filter((f) => keys.includes(f.key)) },
        },
      });
      const ids = created.length ? created.map((c) => c.id) : (await db.select({ id: products.id }).from(products).where(eq(products.tenantId, t.id))).map((r) => r.id);
      await setBotProducts(ctx, bot.id, { add: ids });
      await publishBot(ctx, bot.id);
    }
  }
}
