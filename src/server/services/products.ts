import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { botProducts, bots, products, tenants } from "../db/schema";
import { sha256 } from "../crypto/vault";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";
import { baseNormalize } from "@/lib/moderation/detect";
import { audit } from "./audit";
import { storageRoot } from "./knowledge";

/**
 * Catálogo de productos por empresa, compartido por sus chatbots.
 * - Título y descripción obligatorios; precio, stock y foto opcionales.
 * - Stock null = "sin especificar" (distinto de 0 = "sin stock"). No se descuenta automáticamente.
 * - "Eliminar" archiva: el producto deja de ofrecerse pero no se rompe el historial.
 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = [
  { mime: "image/jpeg", ext: ".jpg", test: (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: ".png", test: (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: ".webp", test: (b: Buffer) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
] as const;

const price = z.union([z.number(), z.string().trim().regex(/^\d+([.,]\d{1,2})?$/).transform((v) => Number(v.replace(",", ".")))]).pipe(z.number().min(0).max(9_999_999_999));
const stock = z.union([z.number(), z.string().trim().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(0).max(10_000_000));

export const productInputSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio.").max(120),
  description: z.string().trim().min(1, "La descripción es obligatoria.").max(4000),
  price: price.nullable().optional(),
  stock: stock.nullable().optional(),
  active: z.boolean().optional(),
});

export type ProductRow = typeof products.$inferSelect;

export function availabilityOf(p: { stock: number | null }): "unknown" | "in_stock" | "out_of_stock" {
  if (p.stock === null || p.stock === undefined) return "unknown";
  return p.stock > 0 ? "in_stock" : "out_of_stock";
}

function toDto(p: ProductRow, botsUsing: { id: string; name: string }[] = []) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: p.price === null ? null : Number(p.price),
    currency: p.currency,
    stock: p.stock,
    availability: availabilityOf(p),
    active: p.active,
    archived: Boolean(p.archivedAt),
    hasPhoto: Boolean(p.photoPath),
    photoUrl: p.photoPath ? `/api/v1/products/${p.id}/photo?v=${(p.photoSha256 ?? "").slice(0, 8)}` : null,
    bots: botsUsing,
    updatedAt: p.updatedAt,
  };
}
export type ProductDto = ReturnType<typeof toDto>;

async function loadProduct(ctx: Ctx, id: string) {
  const p = await db.query.products.findFirst({ where: and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)) });
  if (!p) throw notFound("Producto inexistente.");
  return p;
}

export const listFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  availability: z.enum(["all", "in_stock", "out_of_stock", "unknown"]).default("all"),
  status: z.enum(["active", "inactive", "archived", "all"]).default("all"),
});

export async function listProducts(ctx: Ctx, input: z.input<typeof listFiltersSchema> = {}) {
  assertCan(ctx, "catalog:read");
  const f = listFiltersSchema.parse(input);
  const filters = [eq(products.tenantId, ctx.tenantId)];
  if (f.status === "archived") filters.push(isNotNull(products.archivedAt));
  else {
    filters.push(isNull(products.archivedAt));
    if (f.status === "active") filters.push(eq(products.active, true));
    if (f.status === "inactive") filters.push(eq(products.active, false));
  }
  if (f.availability === "unknown") filters.push(isNull(products.stock));
  if (f.availability === "in_stock") filters.push(sql`${products.stock} > 0`);
  if (f.availability === "out_of_stock") filters.push(eq(products.stock, 0));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(sql`(${products.title} ilike ${like} or ${products.description} ilike ${like})`);
  }
  const rows = await db.select().from(products).where(and(...filters)).orderBy(asc(products.title)).limit(1000);
  const links = rows.length
    ? await db
        .select({ productId: botProducts.productId, botId: bots.id, botName: bots.name })
        .from(botProducts)
        .innerJoin(bots, eq(bots.id, botProducts.botId))
        .where(and(eq(botProducts.tenantId, ctx.tenantId), inArray(botProducts.productId, rows.map((r) => r.id))))
    : [];
  return rows.map((r) => toDto(r, links.filter((l) => l.productId === r.id).map((l) => ({ id: l.botId, name: l.botName }))));
}

export async function createProduct(ctx: Ctx, input: z.input<typeof productInputSchema>) {
  assertCan(ctx, "catalog:write");
  const d = productInputSchema.parse(input);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
  const [p] = await db
    .insert(products)
    .values({ tenantId: ctx.tenantId, title: d.title, description: d.description, price: d.price === null || d.price === undefined ? null : String(d.price), stock: d.stock ?? null, active: d.active ?? true, currency: tenant?.defaultCurrency ?? "ARS", createdBy: actorUserId(ctx) })
    .returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "product.created", targetType: "product", targetId: p.id });
  return toDto(p);
}

export async function updateProduct(ctx: Ctx, id: string, input: Partial<z.input<typeof productInputSchema>>) {
  assertCan(ctx, "catalog:write");
  const d = productInputSchema.partial().parse(input);
  const p = await loadProduct(ctx, id);
  if (p.archivedAt) throw badRequest("El producto está archivado. Restauralo para editarlo.");
  const patch: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.description !== undefined) patch.description = d.description;
  // undefined = no cambia; null = se borra (precio/stock "sin especificar")
  if (d.price !== undefined) patch.price = d.price === null ? null : String(d.price);
  if (d.stock !== undefined) patch.stock = d.stock;
  if (d.active !== undefined) patch.active = d.active;
  const [row] = await db.update(products).set(patch).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId))).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "product.updated", targetType: "product", targetId: id, data: { fields: Object.keys(d) } });
  return toDto(row);
}

/** "Eliminar": archiva (se conserva para el historial) y lo quita de los bots. */
export async function archiveProduct(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:write");
  await loadProduct(ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(products).set({ archivedAt: new Date(), active: false, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)));
    await tx.delete(botProducts).where(and(eq(botProducts.productId, id), eq(botProducts.tenantId, ctx.tenantId)));
  });
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "product.archived", targetType: "product", targetId: id });
  return { ok: true };
}

export async function restoreProduct(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:write");
  await loadProduct(ctx, id);
  const [row] = await db.update(products).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId))).returning();
  return toDto(row);
}

function photoDir(tenantId: string) {
  return path.join(storageRoot(), "products", tenantId);
}
function resolvePhoto(rel: string) {
  const abs = path.resolve(storageRoot(), rel);
  // defensa: nunca leer fuera del almacenamiento
  if (!abs.startsWith(storageRoot() + path.sep)) throw notFound();
  return abs;
}

/** Sube o reemplaza la foto validando tamaño y tipo REAL (firma del archivo, no la extensión). */
export async function uploadProductPhoto(ctx: Ctx, id: string, bytes: Buffer) {
  assertCan(ctx, "catalog:write");
  const p = await loadProduct(ctx, id);
  if (p.archivedAt) throw badRequest("El producto está archivado.");
  if (bytes.length === 0) throw badRequest("El archivo está vacío.");
  if (bytes.length > MAX_PHOTO_BYTES) throw badRequest("La foto supera los 5 MB.");
  const type = PHOTO_TYPES.find((t) => t.test(bytes));
  if (!type) throw badRequest("Formato no admitido. Usá una imagen JPG, PNG o WEBP.");
  const hash = sha256(bytes);
  const dir = photoDir(ctx.tenantId);
  await mkdir(dir, { recursive: true });
  const rel = path.join("products", ctx.tenantId, `${p.id}-${hash.slice(0, 12)}${type.ext}`);
  await writeFile(path.join(storageRoot(), rel), bytes, { mode: 0o600 });
  const [row] = await db
    .update(products)
    .set({ photoPath: rel, photoMime: type.mime, photoSize: bytes.length, photoSha256: hash, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
    .returning();
  if (p.photoPath && p.photoPath !== rel) await unlink(resolvePhoto(p.photoPath)).catch(() => undefined);
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "product.photo_uploaded", targetType: "product", targetId: id, data: { mime: type.mime, size: bytes.length } });
  return toDto(row);
}

export async function deleteProductPhoto(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:write");
  const p = await loadProduct(ctx, id);
  const [row] = await db.update(products).set({ photoPath: null, photoMime: null, photoSize: null, photoSha256: null, updatedAt: new Date() }).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId))).returning();
  if (p.photoPath) await unlink(resolvePhoto(p.photoPath)).catch(() => undefined);
  return toDto(row);
}

/** Lectura de la foto con control de acceso por empresa. */
export async function readProductPhoto(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:read");
  const p = await loadProduct(ctx, id);
  if (!p.photoPath || !p.photoMime) throw notFound("El producto no tiene foto.");
  return { bytes: await readFile(resolvePhoto(p.photoPath)), mime: p.photoMime, sha: p.photoSha256 ?? "" };
}

/** Para el runtime (sin contexto de usuario): foto de un producto de la empresa. */
export async function loadPhotoForSend(tenantId: string, productId: string) {
  const p = await db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.tenantId, tenantId), isNull(products.archivedAt)) });
  if (!p?.photoPath || !p.photoMime) return null;
  return { bytes: await readFile(resolvePhoto(p.photoPath)), mime: p.photoMime, fileName: `${p.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "producto"}${PHOTO_TYPES.find((t) => t.mime === p.photoMime)?.ext ?? ""}`, title: p.title };
}

/* ------------------------- asociación con bots ------------------------- */

export async function listBotProductIds(ctx: Ctx, botId: string) {
  assertCan(ctx, "bot:read");
  const rows = await db.select({ productId: botProducts.productId }).from(botProducts).where(and(eq(botProducts.botId, botId), eq(botProducts.tenantId, ctx.tenantId)));
  return rows.map((r) => r.productId);
}

/** Asocia o desasocia productos a un bot (borrador: se aplica al publicar). */
export async function setBotProducts(ctx: Ctx, botId: string, input: { add?: string[]; remove?: string[] }) {
  assertCan(ctx, "bot:write");
  const bot = await db.query.bots.findFirst({ where: and(eq(bots.id, botId), eq(bots.tenantId, ctx.tenantId)) });
  if (!bot) throw notFound();
  const add = [...new Set(input.add ?? [])].slice(0, 1000);
  const remove = [...new Set(input.remove ?? [])].slice(0, 1000);
  if (add.length) {
    const own = await db.select({ id: products.id }).from(products).where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, add), isNull(products.archivedAt)));
    if (own.length !== add.length) throw badRequest("Algún producto no existe en tu catálogo.");
    await db.insert(botProducts).values(add.map((productId) => ({ tenantId: ctx.tenantId, botId, productId }))).onConflictDoNothing();
  }
  if (remove.length) await db.delete(botProducts).where(and(eq(botProducts.botId, botId), eq(botProducts.tenantId, ctx.tenantId), inArray(botProducts.productId, remove)));
  await db.update(bots).set({ updatedAt: new Date() }).where(eq(bots.id, botId));
  return listBotProductIds(ctx, botId);
}

/* ------------------------------ búsqueda ------------------------------ */

const STOP = new Set(
  "de del la las el los un una unos unas y o en con para por que q me te se mi tu su al lo le les es son hay tienen tenes tiene tenés quiero queria quería necesito busco buscando precio precios cuanto cuánto sale cuesta valor stock hola buenas buen dia día tarde noches gracias favor info información informacion sobre algo alguno alguna the a an and or of for to in is are do you have i need want price how much hi hello please".split(" ").map((w) => baseNormalize(w)),
);
const words = (t: string) =>
  baseNormalize(t)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP.has(w));
/** Comparación tolerante a plurales simples ("taladros" ~ "taladro"). */
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w);

export type CatalogItem = { id: string; title: string; description: string; price: number | null; currency: string; stock: number | null; hasPhoto: boolean };

/**
 * Busca productos relevantes para un mensaje dentro del alcance permitido (solo la empresa;
 * con `productIds` solo los asociados al bot). Devuelve también el total para orientar a la IA.
 */
export async function searchCatalog(tenantId: string, scope: { productIds: string[] | null }, query: string, limit = 5): Promise<{ matches: CatalogItem[]; total: number; overview: CatalogItem[] }> {
  if (scope.productIds && scope.productIds.length === 0) return { matches: [], total: 0, overview: [] };
  const filters = [eq(products.tenantId, tenantId), isNull(products.archivedAt), eq(products.active, true)];
  if (scope.productIds) filters.push(inArray(products.id, scope.productIds));
  const rows = await db.select().from(products).where(and(...filters)).orderBy(desc(products.updatedAt)).limit(2000);
  const items: CatalogItem[] = rows.map((r) => ({ id: r.id, title: r.title, description: r.description, price: r.price === null ? null : Number(r.price), currency: r.currency, stock: r.stock, hasPhoto: Boolean(r.photoPath) }));
  const q = words(query).map(stem);
  const scored = q.length
    ? items
        .map((it) => {
          const tw = words(it.title).map(stem);
          const dw = new Set(words(it.description).map(stem));
          let score = 0;
          for (const w of q) {
            if (tw.includes(w)) score += 3;
            else if (tw.some((t) => t.length >= 4 && w.length >= 4 && (t.startsWith(w) || w.startsWith(t)))) score += 2;
            else if (dw.has(w)) score += 1;
          }
          return { it, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
    : [];
  return { matches: scored.slice(0, limit).map((x) => x.it), total: items.length, overview: items.length <= 15 ? items : [] };
}

/** Productos vigentes (no archivados) de la empresa por id. */
export async function getCatalogItems(tenantId: string, ids: string[]): Promise<CatalogItem[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, ids), isNull(products.archivedAt)));
  return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, price: r.price === null ? null : Number(r.price), currency: r.currency, stock: r.stock, hasPhoto: Boolean(r.photoPath) }));
}
