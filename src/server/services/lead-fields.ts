import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { contacts, leadFields, type LeadData } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import { baseNormalize } from "@/lib/moderation/detect";
import { audit } from "./audit";

/**
 * Datos comerciales por empresa ("objetivos" que el bot puede recopilar): definiciones en
 * lead_fields y valores en contacts.lead_data. El bot solo escribe campos habilitados en su
 * configuración, con valores validados; nunca completa campos vacíos con datos inventados.
 */
export const leadFieldSchema = z.object({
  label: z.string().trim().min(2).max(60),
  type: z.enum(["text", "number", "choice"]).default("text"),
  options: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  hint: z.string().trim().max(200).nullable().optional(),
});

export type LeadFieldRow = typeof leadFields.$inferSelect;

export function slugKey(label: string) {
  return baseNormalize(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "campo";
}

export async function listLeadFields(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  assertCan(ctx, "contact:read");
  const filters = [eq(leadFields.tenantId, ctx.tenantId)];
  if (!opts.includeInactive) filters.push(eq(leadFields.active, true));
  return db.select().from(leadFields).where(and(...filters)).orderBy(asc(leadFields.position), asc(leadFields.createdAt));
}

export async function activeLeadFields(tenantId: string) {
  return db.select().from(leadFields).where(and(eq(leadFields.tenantId, tenantId), eq(leadFields.active, true))).orderBy(asc(leadFields.position));
}

export async function createLeadField(ctx: Ctx, input: z.input<typeof leadFieldSchema>) {
  assertCan(ctx, "bot:write");
  const d = leadFieldSchema.parse(input);
  if (d.type === "choice" && d.options.length < 2) throw badRequest("Una lista de opciones necesita al menos 2 opciones.");
  const key = slugKey(d.label);
  if (!/^[a-z0-9_]{2,40}$/.test(key)) throw badRequest("Nombre inválido para el campo.");
  const exists = await db.query.leadFields.findFirst({ where: and(eq(leadFields.tenantId, ctx.tenantId), eq(leadFields.key, key)) });
  if (exists) {
    if (exists.active) throw conflict("Ya existe un campo con ese nombre.");
    const [row] = await db.update(leadFields).set({ active: true, label: d.label, type: d.type, options: d.options, hint: d.hint ?? null }).where(eq(leadFields.id, exists.id)).returning();
    return row;
  }
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${leadFields.position}), -1)::int` }).from(leadFields).where(eq(leadFields.tenantId, ctx.tenantId));
  const [row] = await db.insert(leadFields).values({ tenantId: ctx.tenantId, key, label: d.label, type: d.type, options: d.options, hint: d.hint ?? null, position: max + 1 }).returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "lead_field.created", targetType: "lead_field", targetId: row.id, data: { key } });
  return row;
}

export async function updateLeadField(ctx: Ctx, id: string, input: Partial<z.input<typeof leadFieldSchema>>) {
  assertCan(ctx, "bot:write");
  const d = leadFieldSchema.partial().parse(input);
  const f = await db.query.leadFields.findFirst({ where: and(eq(leadFields.id, id), eq(leadFields.tenantId, ctx.tenantId)) });
  if (!f) throw notFound();
  const type = d.type ?? f.type;
  const options = d.options ?? f.options;
  if (type === "choice" && options.length < 2) throw badRequest("Una lista de opciones necesita al menos 2 opciones.");
  // la clave no cambia: los valores guardados y la configuración de los bots siguen siendo válidos
  const [row] = await db.update(leadFields).set({ label: d.label ?? f.label, type, options, hint: d.hint === undefined ? f.hint : d.hint }).where(eq(leadFields.id, id)).returning();
  return row;
}

/** Desactiva (no borra): los datos ya guardados en contactos se conservan. */
export async function deactivateLeadField(ctx: Ctx, id: string) {
  assertCan(ctx, "bot:write");
  const res = await db.update(leadFields).set({ active: false }).where(and(eq(leadFields.id, id), eq(leadFields.tenantId, ctx.tenantId))).returning();
  if (!res.length) throw notFound();
  return { ok: true };
}

/** Valida y normaliza un valor según el tipo del campo. null = inválido o vacío. */
export function normalizeLeadValue(def: Pick<LeadFieldRow, "type" | "options">, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().slice(0, 200);
  if (!s || /^(null|undefined|n\/a|desconocido|sin dato|no sabe|ninguno)$/i.test(s)) return null;
  if (def.type === "number") {
    const m = s.replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) && n >= 0 && n < 1e12 ? String(n) : null;
  }
  if (def.type === "choice") {
    const norm = baseNormalize(s);
    return def.options.find((o) => baseNormalize(o) === norm) ?? null;
  }
  return s;
}

/** Valores de un contacto (para paneles), incluyendo qué campos faltan. */
export async function contactLeadSummary(tenantId: string, contactId: string) {
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)) });
  if (!contact) return null;
  const fields = await activeLeadFields(tenantId);
  const data = (contact.leadData ?? {}) as LeadData;
  return fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, value: data[f.key]?.value ?? null, source: data[f.key]?.source ?? null, updatedAt: data[f.key]?.updatedAt ?? null }));
}

export const setLeadValueSchema = z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), value: z.string().trim().max(200).nullable() });

/** Edición manual desde la ficha del contacto o la conversación. */
export async function setContactLeadValue(ctx: Ctx, contactId: string, input: z.input<typeof setLeadValueSchema>) {
  assertCan(ctx, "contact:write");
  const d = setLeadValueSchema.parse(input);
  const f = await db.query.leadFields.findFirst({ where: and(eq(leadFields.tenantId, ctx.tenantId), eq(leadFields.key, d.key)) });
  if (!f) throw notFound("Campo inexistente.");
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, ctx.tenantId)) });
  if (!contact) throw notFound();
  const data = { ...((contact.leadData ?? {}) as LeadData) };
  if (d.value === null || d.value === "") delete data[d.key];
  else {
    const v = normalizeLeadValue(f, d.value);
    if (v === null) throw badRequest(f.type === "number" ? "Ingresá un número." : f.type === "choice" ? `Elegí una de las opciones: ${f.options.join(", ")}.` : "Valor inválido.");
    data[d.key] = { value: v, updatedAt: new Date().toISOString(), source: "user" };
  }
  await db.update(contacts).set({ leadData: data, updatedAt: new Date() }).where(eq(contacts.id, contactId));
  return contactLeadSummary(ctx.tenantId, contactId);
}

/**
 * Aplica datos recopilados por el bot: solo claves habilitadas y valores válidos. Un dato
 * ingresado por una persona no se pisa con uno del bot. Devuelve lo aplicado y lo descartado.
 */
export async function applyCollectedLeadData(tenantId: string, contactId: string, allowedKeys: string[], collected: Record<string, unknown>, runner: Tx | typeof db = db) {
  const applied: { key: string; value: string }[] = [];
  const rejected: { key: string; reason: string }[] = [];
  const entries = Object.entries(collected ?? {}).slice(0, 20);
  if (!entries.length) return { applied, rejected };
  const fields = await activeLeadFields(tenantId);
  const contact = await runner.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)) });
  if (!contact) return { applied, rejected };
  const data = { ...((contact.leadData ?? {}) as LeadData) };
  for (const [key, raw] of entries) {
    const def = fields.find((f) => f.key === key);
    if (!def || !allowedKeys.includes(key)) {
      rejected.push({ key, reason: "campo no habilitado" });
      continue;
    }
    const v = normalizeLeadValue(def, raw);
    if (v === null) {
      if (raw !== null && raw !== undefined && String(raw).trim()) rejected.push({ key, reason: "valor inválido" });
      continue;
    }
    if (data[key]?.source === "user" && data[key].value !== v) {
      rejected.push({ key, reason: "ya cargado por una persona" });
      continue;
    }
    if (data[key]?.value === v) continue;
    data[key] = { value: v, updatedAt: new Date().toISOString(), source: "bot" };
    applied.push({ key, value: v });
  }
  if (applied.length) await runner.update(contacts).set({ leadData: data, updatedAt: new Date() }).where(eq(contacts.id, contactId));
  return { applied, rejected };
}
