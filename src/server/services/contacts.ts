import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { db } from "../db";
import { contacts, conversations, opportunities } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, conflict, notFound } from "../http/errors";
import { audit } from "./audit";
import { listContactOpportunities } from "./opportunities";

export async function listContacts(ctx: Ctx, opts: { q?: string; tag?: string; page?: number } = {}) {
  assertCan(ctx, "contact:read");
  const page = Math.max(1, opts.page ?? 1);
  const filters = [eq(contacts.tenantId, ctx.tenantId)];
  if (opts.q?.trim()) {
    const q = opts.q.trim().replace(/[%_]/g, "");
    const digits = q.replace(/\D/g, "");
    filters.push(or(ilike(contacts.name, `%${q}%`), ilike(contacts.email, `%${q}%`), digits.length >= 3 ? ilike(contacts.phoneE164, `%${digits}%`) : sql`false`)!);
  }
  if (opts.tag) filters.push(sql`${opts.tag} = any(${contacts.tags})`);
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      phoneE164: contacts.phoneE164,
      email: contacts.email,
      tags: contacts.tags,
      createdAt: contacts.createdAt,
      openOpportunities: sql<number>`(select count(*)::int from ${opportunities} o where o.contact_id = "contacts"."id" and o.status = 'open')`,
      lastMessageAt: sql<Date | null>`(select max(c.last_message_at) from ${conversations} c where c.contact_id = "contacts"."id")`,
    })
    .from(contacts)
    .where(and(...filters))
    .orderBy(desc(contacts.updatedAt))
    .limit(51)
    .offset((page - 1) * 50);
  return { items: rows.slice(0, 50), hasMore: rows.length > 50, page };
}

export async function getContact(ctx: Ctx, id: string) {
  assertCan(ctx, "contact:read");
  const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)) });
  if (!c) throw notFound();
  const convs = await db
    .select({ id: conversations.id, status: conversations.status, attentionMode: conversations.attentionMode, lastMessageAt: conversations.lastMessageAt, lastMessagePreview: conversations.lastMessagePreview })
    .from(conversations)
    .where(and(eq(conversations.tenantId, ctx.tenantId), eq(conversations.contactId, id)))
    .orderBy(desc(conversations.lastMessageAt));
  const opps = await listContactOpportunities(ctx, [id]);
  return { contact: c, conversations: convs, opportunities: opps };
}

const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(20);

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  tags: tagsSchema.optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function createContact(ctx: Ctx, input: z.input<typeof contactInputSchema>) {
  assertCan(ctx, "contact:write");
  const data = contactInputSchema.parse(input);
  const phone = data.phone ? toE164(data.phone) : null;
  if (data.phone && !phone) throw badRequest("Teléfono inválido. Usá formato internacional, p. ej. +54 9 11 1234-5678.");
  if (phone) {
    const dup = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.phoneE164, phone)) });
    if (dup) throw conflict("Ya existe un contacto con ese teléfono.", { contactId: dup.id });
  }
  const [c] = await db
    .insert(contacts)
    .values({ tenantId: ctx.tenantId, name: data.name, phoneE164: phone, email: data.email || null, tags: data.tags ?? [], notes: data.notes ?? null })
    .returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "contact.created", targetType: "contact", targetId: c.id });
  return c;
}

export async function updateContact(ctx: Ctx, id: string, input: Partial<z.input<typeof contactInputSchema>>) {
  assertCan(ctx, "contact:write");
  const data = contactInputSchema.partial().parse(input);
  const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)) });
  if (!c) throw notFound();
  const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.email !== undefined) patch.email = data.email || null;
  if (data.tags !== undefined) patch.tags = data.tags;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.phone !== undefined) {
    // la identidad de canal (teléfono de WhatsApp) no se cambia si el contacto vino de WhatsApp
    if (c.chatwootContactId && c.phoneE164) throw badRequest("El teléfono de un contacto de WhatsApp no se puede editar.");
    const phone = data.phone ? toE164(data.phone) : null;
    if (data.phone && !phone) throw badRequest("Teléfono inválido.");
    patch.phoneE164 = phone;
  }
  const [u] = await db.update(contacts).set(patch).where(eq(contacts.id, id)).returning();
  return u;
}
