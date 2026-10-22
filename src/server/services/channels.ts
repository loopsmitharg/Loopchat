import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { db } from "../db";
import { channelConnections } from "../db/schema";
import { decryptSecret, encryptSecret, secretHint } from "../crypto/vault";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { getTenantChatwoot } from "../chatwoot/tenant-client";
import { badRequest, conflict, notFound } from "../http/errors";
import { verifyMetaPhoneNumber } from "../meta/graph";
import { audit } from "./audit";
import { assertResourceQuota } from "./usage";

function view(c: typeof channelConnections.$inferSelect) {
  return {
    id: c.id,
    displayName: c.displayName,
    phoneNumber: c.phoneNumber,
    wabaId: c.wabaId,
    phoneNumberId: c.phoneNumberId,
    tokenHint: c.tokenHint,
    chatwootInboxId: c.chatwootInboxId,
    status: c.status,
    lastVerifiedAt: c.lastVerifiedAt,
    lastError: c.lastError,
    tokenRotatedAt: c.tokenRotatedAt,
    billingOwnerConfirmed: c.billingOwnerConfirmed,
    createdAt: c.createdAt,
  };
}
export type ChannelView = ReturnType<typeof view>;

export async function listChannels(ctx: Ctx) {
  assertCan(ctx, "settings:read");
  const rows = await db.select().from(channelConnections).where(eq(channelConnections.tenantId, ctx.tenantId)).orderBy(asc(channelConnections.createdAt));
  return rows.map(view);
}

const digits = (label: string) => z.string().trim().regex(/^\d{5,30}$/, `${label}: solo números.`);

export const channelSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  phoneNumber: z.string().trim().min(6).max(30),
  wabaId: digits("WABA ID"),
  phoneNumberId: digits("Phone Number ID"),
  accessToken: z.string().trim().min(20).max(1000),
  billingOwnerConfirmed: z.literal(true, { message: "Confirmá que la facturación de Meta está a nombre de tu empresa." }),
});

/**
 * Alta guiada de un número de WhatsApp Cloud API propio del cliente:
 * 1) cuota del plan, 2) verificación de solo lectura en Meta, 3) bandeja en Chatwoot (que valida
 * credenciales y recibe los webhooks de Meta). El token queda cifrado; nunca se devuelve.
 */
export async function connectWhatsapp(ctx: Ctx, input: z.input<typeof channelSchema>) {
  assertCan(ctx, "credentials:manage");
  const data = channelSchema.parse(input);
  const phone = toE164(data.phoneNumber);
  if (!phone) throw badRequest("Número inválido. Usá formato internacional, p. ej. +54 9 11 1234-5678.");
  const dup = await db.query.channelConnections.findFirst({ where: eq(channelConnections.phoneNumberId, data.phoneNumberId) });
  if (dup && dup.tenantId !== ctx.tenantId) throw conflict("Ese número ya está conectado en otra cuenta de Loopchat. Si es tuyo, contactá a Loop Smiths.");
  if (dup) throw conflict("Ese número ya está conectado en tu empresa.");

  const row = await db.transaction(async (tx) => {
    await assertResourceQuota(tx, ctx.tenantId, "whatsappNumbers", 1);
    const [c] = await tx
      .insert(channelConnections)
      .values({
        tenantId: ctx.tenantId,
        displayName: data.displayName,
        phoneNumber: phone,
        wabaId: data.wabaId,
        phoneNumberId: data.phoneNumberId,
        accessTokenEnc: encryptSecret(data.accessToken, `meta:${ctx.tenantId}`),
        tokenHint: secretHint(data.accessToken),
        billingOwnerConfirmed: true,
        status: "pending_verification",
      })
      .returning();
    await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "channel.created", targetType: "channel", targetId: c.id, data: { phone, phoneNumberId: data.phoneNumberId, wabaId: data.wabaId } }, tx);
    return c;
  });
  return verifyAndLink(ctx, row.id, data.accessToken);
}

async function verifyAndLink(ctx: Ctx, channelId: string, token: string) {
  const c = await db.query.channelConnections.findFirst({ where: and(eq(channelConnections.id, channelId), eq(channelConnections.tenantId, ctx.tenantId)) });
  if (!c) throw notFound();
  const meta = await verifyMetaPhoneNumber({ phoneNumberId: c.phoneNumberId, accessToken: token });
  if (!meta.ok) {
    const [u] = await db.update(channelConnections).set({ status: "error", lastError: meta.error, lastVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(channelConnections.id, c.id)).returning();
    return view(u);
  }
  try {
    const { client } = await getTenantChatwoot(ctx.tenantId);
    let inboxId = c.chatwootInboxId;
    if (inboxId) await client.updateWhatsappInboxToken(inboxId, { apiKey: token, phoneNumberId: c.phoneNumberId, businessAccountId: c.wabaId });
    else inboxId = (await client.createWhatsappInbox({ name: `WhatsApp ${c.displayName}`, phoneNumber: c.phoneNumber, apiKey: token, phoneNumberId: c.phoneNumberId, businessAccountId: c.wabaId })).id;
    const [u] = await db
      .update(channelConnections)
      .set({ status: "connected", chatwootInboxId: inboxId, lastError: null, lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(channelConnections.id, c.id))
      .returning();
    return view(u);
  } catch (e) {
    const [u] = await db.update(channelConnections).set({ status: "error", lastError: (e as Error).message.slice(0, 300), lastVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(channelConnections.id, c.id)).returning();
    return view(u);
  }
}

export async function reverifyChannel(ctx: Ctx, id: string) {
  assertCan(ctx, "credentials:manage");
  const c = await db.query.channelConnections.findFirst({ where: and(eq(channelConnections.id, id), eq(channelConnections.tenantId, ctx.tenantId)) });
  if (!c) throw notFound();
  if (c.status === "disconnected") throw badRequest("El número está desconectado. Volvé a conectarlo con un token nuevo.");
  return verifyAndLink(ctx, c.id, decryptSecret(c.accessTokenEnc, `meta:${ctx.tenantId}`));
}

export async function rotateChannelToken(ctx: Ctx, id: string, accessToken: string) {
  assertCan(ctx, "credentials:manage");
  const token = z.string().trim().min(20).max(1000).parse(accessToken);
  const c = await db.query.channelConnections.findFirst({ where: and(eq(channelConnections.id, id), eq(channelConnections.tenantId, ctx.tenantId)) });
  if (!c) throw notFound();
  await db
    .update(channelConnections)
    .set({ accessTokenEnc: encryptSecret(token, `meta:${ctx.tenantId}`), tokenHint: secretHint(token), tokenRotatedAt: new Date(), status: "pending_verification", updatedAt: new Date() })
    .where(eq(channelConnections.id, c.id));
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "channel.token_rotated", targetType: "channel", targetId: c.id });
  return verifyAndLink(ctx, c.id, token);
}

/**
 * Desconexión segura: Loopchat deja de usar el número (sin envíos ni bots) y libera el cupo.
 * NO borra la bandeja en Chatwoot para no perder historial (ver docs/operations.md).
 */
export async function disconnectChannel(ctx: Ctx, id: string) {
  assertCan(ctx, "credentials:manage");
  const res = await db
    .update(channelConnections)
    .set({ status: "disconnected", accessTokenEnc: encryptSecret("revoked", `meta:${ctx.tenantId}`), tokenHint: "revocado", updatedAt: new Date() })
    .where(and(eq(channelConnections.id, id), eq(channelConnections.tenantId, ctx.tenantId)))
    .returning();
  if (res.length === 0) throw notFound();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "channel.disconnected", targetType: "channel", targetId: id });
  return view(res[0]);
}
