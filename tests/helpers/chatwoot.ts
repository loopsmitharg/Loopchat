import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatwootAccounts, conversations } from "@/server/db/schema";
import { receiveChatwootWebhook } from "@/server/chatwoot/receive";
import { drainOnce } from "@/server/jobs/worker";
import { provisionChatwootAccount } from "@/server/services/chatwoot-provisioning";
import { connectWhatsapp } from "@/server/services/channels";
import type { Ctx } from "@/server/authz/context";

let relay: Server | null = null;
export let relayHits = 0;

/** Relay HTTP que recibe los webhooks del simulador y llama al MISMO receptor que usa la ruta Next. */
export async function startWebhookRelay() {
  if (relay) return;
  relay = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const key = (req.url ?? "").split("/").pop() ?? "";
    relayHits++;
    const r = await receiveChatwootWebhook({
      key,
      rawBody: Buffer.concat(chunks).toString("utf8"),
      signature: (req.headers["x-chatwoot-signature"] as string) ?? null,
      timestamp: (req.headers["x-chatwoot-timestamp"] as string) ?? null,
      deliveryId: (req.headers["x-chatwoot-delivery"] as string) ?? null,
    });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((r) => relay!.listen(3013, r));
}

/** Procesa la cola hasta que no queden trabajos (incluye webhooks que emite el simulador). */
export async function settle(maxMs = 6000) {
  const end = Date.now() + maxMs;
  let idle = 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 120));
    const n = await drainOnce();
    idle = n === 0 ? idle + 1 : 0;
    if (idle >= 3) return;
  }
}

export async function provisionWithChannel(ctx: Ctx) {
  await provisionChatwootAccount(ctx.tenantId, null);
  const mapping = (await db.query.chatwootAccounts.findFirst({ where: eq(chatwootAccounts.tenantId, ctx.tenantId) }))!;
  const suffix = String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  const channel = await connectWhatsapp(ctx, {
    displayName: "Ventas",
    phoneNumber: `+54911${suffix.slice(-8)}`,
    wabaId: `1${suffix}`,
    phoneNumberId: `2${suffix}`,
    accessToken: "EAAtest-token-solo-simulador-1234567890",
    billingOwnerConfirmed: true,
  });
  return { accountId: mapping.chatwootAccountId, channel };
}

export async function simIncoming(accountId: number, input: { phone: string; name?: string; content: string; inboxId?: number; duplicateDelivery?: boolean; ageSeconds?: number; attachment?: boolean }) {
  const r = await fetch("http://localhost:3011/__sim/incoming", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, ...input }) });
  return (await r.json()) as { conversationId: number; messageId: number };
}

export async function simState() {
  return (await (await fetch("http://localhost:3011/__sim/state")).json()) as {
    accounts: { id: number; conversations: { id: number; messages: { id: number; content: string; message_type: number; private: boolean; status: string; content_attributes: Record<string, unknown> }[] }[] }[];
    deliveries: { event: string; status: number }[];
  };
}

export async function simMessages(accountId: number, cwConversationId: number) {
  const s = await simState();
  return s.accounts.find((a) => a.id === accountId)?.conversations.find((c) => c.id === cwConversationId)?.messages ?? [];
}

export async function localConversation(tenantId: string, cwConversationId: number) {
  const rows = await db.select().from(conversations).where(eq(conversations.tenantId, tenantId));
  return rows.find((r) => r.chatwootConversationId === cwConversationId) ?? null;
}

export const aiSim = {
  reset: () => fetch("http://localhost:3012/__sim/reset"),
  mode: (m: "ok" | "error500" | "slow") => fetch(`http://localhost:3012/__sim/mode?m=${m}`),
  requests: async () => (await (await fetch("http://localhost:3012/__sim/requests")).json()) as { provider: string; keyTail: string; model: string; lastUser: string; system: string }[],
};
