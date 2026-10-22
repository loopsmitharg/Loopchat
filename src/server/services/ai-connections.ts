import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { aiProviderConnections, AI_PROVIDERS } from "../db/schema";
import { decryptSecret, encryptSecret, secretHint } from "../crypto/vault";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { assertSafeOutboundUrl } from "../http/ssrf";
import { badRequest, notFound, quotaExceeded } from "../http/errors";
import { buildProvider } from "../ai/registry";
import { completeAiCall, reserveAiCall } from "./usage";
import { audit } from "./audit";

/** Vista pública: NUNCA incluye la clave, solo un hint. */
function publicView(r: typeof aiProviderConnections.$inferSelect) {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    baseUrl: r.baseUrl,
    keyHint: r.keyHint,
    defaultModel: r.defaultModel,
    status: r.status,
    lastVerifiedAt: r.lastVerifiedAt,
    lastError: r.lastError,
    createdAt: r.createdAt,
  };
}
export type AiConnectionView = ReturnType<typeof publicView>;

const modelSchema = z.string().trim().min(2).max(100).regex(/^[\w.\-:/@]+$/, "Nombre de modelo inválido.");

export const createAiConnectionSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(2).max(60),
  apiKey: z.string().trim().min(10).max(400),
  baseUrl: z.string().trim().url().max(300).optional().or(z.literal("")),
  defaultModel: modelSchema,
});

export async function listAiConnections(ctx: Ctx) {
  assertCan(ctx, "bot:read");
  const rows = await db.select().from(aiProviderConnections).where(eq(aiProviderConnections.tenantId, ctx.tenantId)).orderBy(desc(aiProviderConnections.createdAt));
  return rows.map(publicView);
}

export async function createAiConnection(ctx: Ctx, input: z.input<typeof createAiConnectionSchema>) {
  assertCan(ctx, "credentials:manage");
  const data = createAiConnectionSchema.parse(input);
  let baseUrl: string | null = null;
  if (data.provider === "openai_compatible" && data.baseUrl) baseUrl = assertSafeOutboundUrl(data.baseUrl, { purpose: "ai" }).toString().replace(/\/$/, "");
  if (data.provider !== "openai_compatible" && data.baseUrl) throw badRequest("Este proveedor usa su URL oficial; no se puede cambiar.");
  const [row] = await db
    .insert(aiProviderConnections)
    .values({
      tenantId: ctx.tenantId,
      provider: data.provider,
      label: data.label,
      baseUrl,
      apiKeyEnc: encryptSecret(data.apiKey, `ai:${ctx.tenantId}`),
      keyHint: secretHint(data.apiKey),
      defaultModel: data.defaultModel,
      createdBy: actorUserId(ctx),
    })
    .returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_connection.created", targetType: "ai_connection", targetId: row.id, data: { provider: data.provider, model: data.defaultModel } });
  return publicView(row);
}

export async function rotateAiKey(ctx: Ctx, id: string, apiKey: string) {
  assertCan(ctx, "credentials:manage");
  const key = z.string().trim().min(10).max(400).parse(apiKey);
  const res = await db
    .update(aiProviderConnections)
    .set({ apiKeyEnc: encryptSecret(key, `ai:${ctx.tenantId}`), keyHint: secretHint(key), status: "unverified", lastError: null, updatedAt: new Date() })
    .where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.tenantId, ctx.tenantId)))
    .returning();
  if (res.length === 0) throw notFound();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_connection.rotated", targetType: "ai_connection", targetId: id });
  return publicView(res[0]);
}

export async function revokeAiConnection(ctx: Ctx, id: string) {
  assertCan(ctx, "credentials:manage");
  const res = await db
    .update(aiProviderConnections)
    // se reemplaza la clave cifrada para que no quede utilizable
    .set({ status: "revoked", apiKeyEnc: encryptSecret("revoked", `ai:${ctx.tenantId}`), keyHint: "revocada", updatedAt: new Date() })
    .where(and(eq(aiProviderConnections.id, id), eq(aiProviderConnections.tenantId, ctx.tenantId)))
    .returning();
  if (res.length === 0) throw notFound();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_connection.revoked", targetType: "ai_connection", targetId: id });
}

/** Carga el proveedor de un tenant (clave descifrada solo en memoria del servidor). */
export async function loadProviderForTenant(tenantId: string, connectionId: string) {
  const row = await db.query.aiProviderConnections.findFirst({ where: and(eq(aiProviderConnections.id, connectionId), eq(aiProviderConnections.tenantId, tenantId)) });
  if (!row || row.status === "revoked") return null;
  const key = decryptSecret(row.apiKeyEnc, `ai:${tenantId}`);
  return { row, provider: buildProvider(row.provider, key, row.baseUrl) };
}

/** Prueba la credencial con una llamada mínima real (cuenta para la cuota). */
export async function testAiConnection(ctx: Ctx, id: string) {
  assertCan(ctx, "credentials:manage");
  const loaded = await loadProviderForTenant(ctx.tenantId, id);
  if (!loaded) throw notFound();
  const reservation = await reserveAiCall(ctx.tenantId, `verify:${id}:${Date.now()}`, { provider: loaded.row.provider, model: loaded.row.defaultModel });
  if (!reservation.ok) throw quotaExceeded("No queda cupo de llamadas de IA este mes para probar la conexión.");
  const res = await loaded.provider.verify(loaded.row.defaultModel);
  await completeAiCall(reservation.eventId, res.ok ? "success" : "failure", { detail: res.ok ? "verify" : res.error });
  const [row] = await db
    .update(aiProviderConnections)
    .set({ status: res.ok ? "verified" : "error", lastVerifiedAt: new Date(), lastError: res.ok ? null : res.error.slice(0, 300), updatedAt: new Date() })
    .where(eq(aiProviderConnections.id, id))
    .returning();
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "ai_connection.tested", targetType: "ai_connection", targetId: id, data: { ok: res.ok } });
  return publicView(row);
}
