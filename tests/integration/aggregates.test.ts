import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { flowRuns, messages } from "@/server/db/schema";
import { createContact, listContacts } from "@/server/services/contacts";
import { createOpportunity, getBoard } from "@/server/services/opportunities";
import { createTask } from "@/server/services/tasks";
import { listTenantsForPlatform } from "@/server/services/tenants";
import { listConversations } from "@/server/services/conversations";
import { createBot, listBots } from "@/server/services/bots";
import { twoTenants } from "../helpers/factory";
import { localConversation, provisionWithChannel, settle, simIncoming, startWebhookRelay } from "../helpers/chatwoot";

describe("agregados por fila (subconsultas correlacionadas)", () => {
  it("contadores de contactos, tablero, conversaciones, bots y tenants son correctos", async () => {
    await startWebhookRelay();
    const { A, ctxA } = await twoTenants();
    const c1 = await createContact(ctxA, { name: "Con 2 opps", phone: "+5491170000001" });
    const c2 = await createContact(ctxA, { name: "Sin opps", phone: "+5491170000002" });
    const o1 = await createOpportunity(ctxA, { contactId: c1.id, title: "Uno" });
    await createOpportunity(ctxA, { contactId: c1.id, title: "Dos" });
    await createTask(ctxA, { title: "Tarea 1", opportunityId: o1.id });
    await createTask(ctxA, { title: "Tarea 2", opportunityId: o1.id });
    const contacts = (await listContacts(ctxA)).items;
    expect(contacts.find((c) => c.id === c1.id)?.openOpportunities).toBe(2);
    expect(contacts.find((c) => c.id === c2.id)?.openOpportunities).toBe(0);
    const board = await getBoard(ctxA);
    expect(board.opportunities.find((o) => o.id === o1.id)?.openTasks).toBe(2);
    expect(board.opportunities.find((o) => o.title === "Dos")?.openTasks).toBe(0);

    const { accountId } = await provisionWithChannel(ctxA);
    const r = await simIncoming(accountId, { phone: "+5491170000003", content: "hola" });
    const r2 = await simIncoming(accountId, { phone: "+5491170000004", content: "hola" });
    await settle();
    const conv = (await localConversation(A.id, r.conversationId))!;
    await db.insert(messages).values({ tenantId: A.id, conversationId: conv.id, direction: "out", senderKind: "agent", status: "failed", idempotencyKey: "agg-failed-1" });
    const list = await listConversations(ctxA, { status: "all" });
    expect(list.items.find((i) => i.id === conv.id)?.lastFailed).toBe(true);
    const conv2 = (await localConversation(A.id, r2.conversationId))!;
    expect(list.items.find((i) => i.id === conv2.id)?.lastFailed).toBe(false);

    const bot = await createBot(ctxA, { name: "Contado", mode: "flow" });
    const bots = await listBots(ctxA);
    expect(bots.find((b) => b.id === bot.id)?.runs7d).toBe(0);
    void flowRuns;

    const tenants = await listTenantsForPlatform();
    expect(tenants.find((t) => t.id === A.id)?.members).toBe(2);
    expect(tenants.find((t) => t.id === A.id)?.numbers).toBe(1);
  });
});
