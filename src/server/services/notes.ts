import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contacts, conversations, internalNotes, opportunities, user as userTable } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { badRequest, notFound } from "../http/errors";

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
});

/** Nota interna: se guarda solo en Loopchat; jamás se envía por WhatsApp. */
export async function addNote(ctx: Ctx, input: z.input<typeof noteSchema>) {
  assertCan(ctx, "conversation:note");
  const data = noteSchema.parse(input);
  if (!data.conversationId && !data.contactId && !data.opportunityId) throw badRequest("La nota debe asociarse a algo.");
  if (data.conversationId && !(await db.query.conversations.findFirst({ where: and(eq(conversations.id, data.conversationId), eq(conversations.tenantId, ctx.tenantId)) }))) throw notFound();
  if (data.contactId && !(await db.query.contacts.findFirst({ where: and(eq(contacts.id, data.contactId), eq(contacts.tenantId, ctx.tenantId)) }))) throw notFound();
  if (data.opportunityId && !(await db.query.opportunities.findFirst({ where: and(eq(opportunities.id, data.opportunityId), eq(opportunities.tenantId, ctx.tenantId)) }))) throw notFound();
  const [n] = await db
    .insert(internalNotes)
    .values({ tenantId: ctx.tenantId, body: data.body, conversationId: data.conversationId, contactId: data.contactId, opportunityId: data.opportunityId, authorUserId: actorUserId(ctx) })
    .returning();
  return n;
}

export async function listConversationNotes(ctx: Ctx, conversationId: string) {
  assertCan(ctx, "conversation:read");
  return db
    .select({ id: internalNotes.id, body: internalNotes.body, authorName: userTable.name, authorUserId: internalNotes.authorUserId, createdAt: internalNotes.createdAt })
    .from(internalNotes)
    .leftJoin(userTable, eq(userTable.id, internalNotes.authorUserId))
    .where(and(eq(internalNotes.tenantId, ctx.tenantId), eq(internalNotes.conversationId, conversationId)))
    .orderBy(desc(internalNotes.createdAt));
}
