import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { chatwootAccounts, tenants } from "../db/schema";
import { encryptSecret, randomToken } from "../crypto/vault";
import { ChatwootAccountClient, ChatwootError, ChatwootPlatformClient, chatwootBaseUrl } from "../chatwoot/client";
import { CW_WEBHOOK_SUBSCRIPTIONS } from "../chatwoot/types";
import { badRequest, conflict, notFound, upstream } from "../http/errors";
import { audit } from "./audit";

function webhookTarget(key: string) {
  const base = process.env.CHATWOOT_WEBHOOK_TARGET_URL || process.env.APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/webhooks/chatwoot/${key}`;
}

function strongPassword() {
  // Chatwoot exige mayúscula, minúscula, número y carácter especial
  return `Lc!${randomBytes(18).toString("base64url")}9a`;
}

async function registerWebhook(client: ChatwootAccountClient, key: string) {
  const res = await client.createWebhook(webhookTarget(key), CW_WEBHOOK_SUBSCRIPTIONS);
  const wh = res.payload.webhook;
  if (!wh.secret) {
    throw upstream("Chatwoot no devolvió un secreto de webhook: la versión instalada no firma eventos. Actualizá a ≥ v4.19 (ver docs/chatwoot-integration.md).");
  }
  return wh;
}

/**
 * Aprovisiona la cuenta Chatwoot del tenant con la Platform App de Loop Smiths:
 * cuenta + usuario de servicio administrador + webhook firmado. Idempotente por tenant.
 */
export async function provisionChatwootAccount(tenantId: string, actorUserId: string | null) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw notFound();
  const existing = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, tenantId) });
  if (existing) return { chatwootAccountId: existing.chatwootAccountId, created: false };
  const token = process.env.CHATWOOT_PLATFORM_TOKEN;
  if (!token) throw badRequest("CHATWOOT_PLATFORM_TOKEN no configurado en el servidor.");
  const platform = new ChatwootPlatformClient(chatwootBaseUrl(), token);
  try {
    const account = await platform.createAccount(`${tenant.name} (Loopchat)`);
    const svc = await platform.createUser({ name: "Loopchat (servicio)", email: `svc-${tenant.id}@loopchat-service.invalid`, password: strongPassword() });
    await platform.addAccountUser(account.id, svc.id, "administrator");
    const client = new ChatwootAccountClient(chatwootBaseUrl(), svc.access_token, account.id);
    const key = randomToken(24);
    const wh = await registerWebhook(client, key);
    await db.insert(chatwootAccounts).values({
      tenantId,
      chatwootAccountId: account.id,
      serviceUserId: svc.id,
      apiTokenEnc: encryptSecret(svc.access_token, `cw:${tenantId}`),
      webhookId: wh.id,
      webhookSecretEnc: encryptSecret(wh.secret!, `cwwh:${tenantId}`),
      webhookKey: key,
      provisionedBy: "platform_api",
    });
    await audit({ tenantId, actorUserId, actorKind: "platform", action: "chatwoot.provisioned", data: { chatwootAccountId: account.id } });
    return { chatwootAccountId: account.id, created: true };
  } catch (e) {
    if (e instanceof ChatwootError) throw upstream(`No se pudo aprovisionar Chatwoot: ${e.message}`, { status: e.status });
    throw e;
  }
}

export const linkManualSchema = z.object({ chatwootAccountId: z.number().int().positive(), apiAccessToken: z.string().min(10).max(200) });

/**
 * Vinculación manual de una cuenta Chatwoot existente (p.ej. creada desde la UI de Chatwoot,
 * que la Platform API no puede administrar). Verifica el token contra esa cuenta antes de guardar.
 */
export async function linkChatwootAccountManually(tenantId: string, input: z.input<typeof linkManualSchema>, actorUserId: string) {
  const data = linkManualSchema.parse(input);
  const taken = await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.chatwootAccountId, data.chatwootAccountId) });
  if (taken && taken.tenantId !== tenantId) throw conflict("Esa cuenta de Chatwoot ya está vinculada a otra empresa.");
  if (taken) throw conflict("La empresa ya tiene una cuenta de Chatwoot vinculada.");
  const client = new ChatwootAccountClient(chatwootBaseUrl(), data.apiAccessToken, data.chatwootAccountId);
  try {
    await client.listConversations({ page: 1 });
  } catch (e) {
    throw upstream(`El token no tiene acceso a la cuenta ${data.chatwootAccountId}: ${(e as Error).message}`);
  }
  const key = randomToken(24);
  const wh = await registerWebhook(client, key);
  await db.insert(chatwootAccounts).values({
    tenantId,
    chatwootAccountId: data.chatwootAccountId,
    apiTokenEnc: encryptSecret(data.apiAccessToken, `cw:${tenantId}`),
    webhookId: wh.id,
    webhookSecretEnc: encryptSecret(wh.secret!, `cwwh:${tenantId}`),
    webhookKey: key,
    provisionedBy: "manual",
  });
  await audit({ tenantId, actorUserId, actorKind: "platform", action: "chatwoot.linked_manually", data: { chatwootAccountId: data.chatwootAccountId } });
  return { chatwootAccountId: data.chatwootAccountId };
}
