import "server-only";
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { botTeams, botTransfers, botVersions, contacts, type ConversationBotState, conversationActivity, conversations, flowRuns, messages, user as userTable, ATTENTION_MODES } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { getTenantChatwoot } from "../chatwoot/tenant-client";
import { ChatwootError } from "../chatwoot/client";
import { badRequest, forbidden, notFound, upstream } from "../http/errors";
import { windowState, cancelActiveRuns } from "./outbound";
import { listConversationNotes } from "./notes";
import { listContactOpportunities } from "./opportunities";
import { isActiveMember } from "./members";
import { assertOperational } from "./usage";
import { selectBotForConversation } from "../flows/trigger";
import { contactLeadSummary } from "./lead-fields";
import { settingsFromVersion } from "../flows/settings";
import { botOfNode, loadTeamVersion, nodeOfBot, pinnedBotVersion, teamHelpers } from "../teams/orchestrator";

export const listFiltersSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "snoozed", "all"]).default("open"),
  mode: z.enum([...ATTENTION_MODES, "all"]).default("all"),
  assignee: z.enum(["mine", "unassigned", "all"]).default("all"),
  q: z.string().max(80).optional(),
  before: z.string().datetime().optional(),
});

const PAGE = 30;

export async function listConversations(ctx: Ctx, input: z.input<typeof listFiltersSchema>) {
  assertCan(ctx, "conversation:read");
  const f = listFiltersSchema.parse(input);
  const filters = [eq(conversations.tenantId, ctx.tenantId)];
  if (f.status !== "all") filters.push(eq(conversations.status, f.status));
  if (f.mode !== "all") filters.push(eq(conversations.attentionMode, f.mode));
  if (f.assignee === "mine" && ctx.actor.kind === "user") filters.push(eq(conversations.assigneeUserId, ctx.actor.userId));
  if (f.assignee === "unassigned") filters.push(isNull(conversations.assigneeUserId));
  if (f.q?.trim()) {
    const q = f.q.trim().replace(/[%_]/g, "");
    const digits = q.replace(/\D/g, "");
    filters.push(or(ilike(contacts.name, `%${q}%`), digits.length >= 3 ? ilike(contacts.phoneE164, `%${digits}%`) : sql`false`, ilike(conversations.lastMessagePreview, `%${q}%`))!);
  }
  if (f.before) filters.push(lt(conversations.lastMessageAt, new Date(f.before)));
  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      attentionMode: conversations.attentionMode,
      assigneeUserId: conversations.assigneeUserId,
      assigneeName: userTable.name,
      lastMessageAt: conversations.lastMessageAt,
      lastIncomingAt: conversations.lastIncomingAt,
      lastMessagePreview: conversations.lastMessagePreview,
      lastMessageDirection: conversations.lastMessageDirection,
      unreadCount: conversations.unreadCount,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phoneE164,
      lastFailed: sql<boolean>`exists(select 1 from ${messages} m where m.conversation_id = "conversations"."id" and m.status = 'failed')`,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(userTable, eq(userTable.id, conversations.assigneeUserId))
    .where(and(...filters))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(PAGE + 1);
  const items = rows.slice(0, PAGE);
  const counts = await db
    .select({
      open: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
      pending: sql<number>`count(*) filter (where ${conversations.status} = 'pending')::int`,
      unassigned: sql<number>`count(*) filter (where ${conversations.assigneeUserId} is null and ${conversations.status} <> 'resolved')::int`,
      mine: ctx.actor.kind === "user" ? sql<number>`count(*) filter (where ${conversations.assigneeUserId} = ${ctx.actor.userId} and ${conversations.status} <> 'resolved')::int` : sql<number>`0`,
    })
    .from(conversations)
    .where(eq(conversations.tenantId, ctx.tenantId));
  return { items, hasMore: rows.length > PAGE, nextBefore: items.length ? items[items.length - 1].lastMessageAt : null, counts: counts[0] };
}

async function loadConv(ctx: Ctx, id: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)) });
  if (!conv) throw notFound("Conversación no encontrada.");
  return conv;
}

export type ThreadMessage = {
  key: string;
  localId: string | null;
  chatwootId: number | null;
  direction: "in" | "out";
  senderKind: "contact" | "agent" | "bot" | "system";
  authorName: string | null;
  content: string | null;
  createdAt: string;
  status: string | null;
  error: string | null;
  isTemplate: boolean;
  attachments: { id: number; type: string; url: string | null; thumbUrl: string | null; size: number | null }[];
  origin: { botId?: string; versionId?: string } | null;
  retryable: boolean;
};

export async function getConversationDetail(ctx: Ctx, id: string, opts: { before?: number } = {}) {
  assertCan(ctx, "conversation:read");
  const conv = await loadConv(ctx, id);
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  const assignee = conv.assigneeUserId ? await db.query.user.findFirst({ where: eq(userTable.id, conv.assigneeUserId) }) : null;

  let remote: Awaited<ReturnType<Awaited<ReturnType<typeof getTenantChatwoot>>["client"]["listMessages"]>> | null = null;
  let remoteError: string | null = null;
  try {
    const { client } = await getTenantChatwoot(ctx.tenantId);
    remote = await client.listMessages(conv.chatwootConversationId, opts.before);
  } catch (e) {
    remoteError = e instanceof ChatwootError ? "No se pudo obtener el historial desde el motor de mensajería. Reintentá en unos segundos." : (e as Error).message;
  }

  const remoteMsgs = (remote?.payload ?? []).filter((m) => !m.private && m.message_type !== 2);
  const locals = await db
    .select({ m: messages, authorName: userTable.name })
    .from(messages)
    .leftJoin(userTable, eq(userTable.id, messages.authorUserId))
    .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, conv.id), or(inArray(messages.chatwootMessageId, remoteMsgs.length ? remoteMsgs.map((m) => m.id) : [-1]), isNull(messages.chatwootMessageId))!));
  const byCw = new Map(locals.filter((l) => l.m.chatwootMessageId).map((l) => [l.m.chatwootMessageId!, l]));

  const thread: ThreadMessage[] = remoteMsgs.map((m) => {
    const l = byCw.get(m.id);
    const direction = m.message_type === 0 ? "in" : "out";
    const status = direction === "out" ? (m.status ?? l?.m.status ?? null) : null;
    return {
      key: `cw-${m.id}`,
      localId: l?.m.id ?? null,
      chatwootId: m.id,
      direction,
      senderKind: direction === "in" ? "contact" : (l?.m.senderKind ?? "agent"),
      authorName: direction === "in" ? (contact?.name ?? null) : (l?.authorName ?? (l?.m.senderKind === "bot" ? "Bot" : (m.sender?.name ?? null))),
      content: m.content,
      createdAt: new Date(m.created_at * 1000).toISOString(),
      status,
      error: status === "failed" ? String((m.content_attributes as { external_error?: string } | null)?.external_error ?? l?.m.error ?? "Falló el envío") : null,
      isTemplate: m.message_type === 3,
      attachments: (m.attachments ?? []).map((a) => ({ id: a.id, type: a.file_type, url: a.data_url, thumbUrl: a.thumb_url ?? null, size: a.file_size ?? null })),
      origin: l?.m.origin ?? null,
      retryable: false,
    };
  });
  // mensajes locales que todavía no llegaron a Chatwoot (pendientes o fallidos)
  for (const l of locals) {
    if (l.m.chatwootMessageId) continue;
    thread.push({
      key: `lc-${l.m.id}`,
      localId: l.m.id,
      chatwootId: null,
      direction: "out",
      senderKind: l.m.senderKind,
      authorName: l.authorName ?? (l.m.senderKind === "bot" ? "Bot" : null),
      content: l.m.pendingContent,
      createdAt: l.m.createdAt.toISOString(),
      status: l.m.status,
      error: l.m.error,
      isTemplate: false,
      attachments: [],
      origin: l.m.origin ?? null,
      retryable: l.m.status === "failed",
    });
  }
  thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const [notes, activity, opps, activeRun, leadData] = await Promise.all([
    listConversationNotes(ctx, conv.id),
    db
      .select({ id: conversationActivity.id, kind: conversationActivity.kind, actorKind: conversationActivity.actorKind, actorName: userTable.name, reason: conversationActivity.reason, data: conversationActivity.data, createdAt: conversationActivity.createdAt })
      .from(conversationActivity)
      .leftJoin(userTable, eq(userTable.id, conversationActivity.actorUserId))
      .where(and(eq(conversationActivity.tenantId, ctx.tenantId), eq(conversationActivity.conversationId, conv.id)))
      .orderBy(desc(conversationActivity.createdAt))
      .limit(30),
    listContactOpportunities(ctx, [conv.contactId]),
    db.query.flowRuns.findFirst({ where: and(eq(flowRuns.conversationId, conv.id), inArray(flowRuns.status, ["queued", "running", "waiting"])) }),
    contactLeadSummary(ctx.tenantId, conv.contactId),
  ]);
  const win = windowState(conv.lastIncomingAt);
  // equipo de chatbots: bot activo (distinto del responsable humano) y bots disponibles para reanudar
  let team: { id: string; name: string; version: number; activeBot: { id: string; name: string; role: string } | null; bots: { id: string; name: string; role: string }[] } | null = null;
  if (conv.teamId && conv.teamVersionId) {
    const tv = await loadTeamVersion(ctx.tenantId, conv.teamVersionId);
    const t = await db.query.botTeams.findFirst({ columns: { name: true }, where: and(eq(botTeams.id, conv.teamId), eq(botTeams.tenantId, ctx.tenantId)) });
    if (tv && t) {
      const h = teamHelpers(tv);
      const bots = tv.graph.nodes.flatMap((n) => (n.type === "bot" && h.isAvailable(n.id) ? [{ id: n.data.botId, name: tv.bots.get(n.data.botId)!.bot.name, role: tv.bots.get(n.data.botId)!.settings.role }] : []));
      const active = conv.activeBotId ? tv.bots.get(conv.activeBotId) : undefined;
      team = { id: conv.teamId, name: t.name, version: tv.version, activeBot: active ? { id: active.bot.id, name: active.bot.name, role: active.settings.role } : null, bots };
    }
  }
  return {
    team,
    conversation: { ...conv, assigneeName: assignee?.name ?? null },
    contact,
    thread,
    remoteError,
    hasOlder: remoteMsgs.length >= 20,
    window: { open: win.open, closesAt: "closesAt" in win ? (win.closesAt ?? null) : null, reason: win.open ? null : win.reason },
    notes,
    activity,
    opportunities: opps,
    activeRun: activeRun ? { id: activeRun.id, status: activeRun.status } : null,
    leadData: leadData ?? [],
    handoff: (() => {
      // último motivo de derivación del bot (para mostrar al vendedor por qué recibió la conversación)
      const h = activity.find((a) => a.kind === "handoff" && a.actorKind === "bot");
      return h ? { reason: h.reason, code: (h.data as { code?: string } | null)?.code ?? null, at: h.createdAt } : null;
    })(),
  };
}

export async function markRead(ctx: Ctx, id: string) {
  assertCan(ctx, "conversation:read");
  await db.update(conversations).set({ unreadCount: 0 }).where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
}

export const assignSchema = z.object({ assigneeUserId: z.string().nullable(), expectedVersion: z.number().int().optional() });

/** Un único responsable por conversación. Agentes solo pueden tomarla para sí o liberarla. */
export async function assignConversation(ctx: Ctx, id: string, input: z.input<typeof assignSchema>) {
  const data = assignSchema.parse(input);
  const me = actorUserId(ctx);
  const isSelf = data.assigneeUserId !== null && data.assigneeUserId === me;
  if (isSelf) assertCan(ctx, "conversation:assign_self");
  else if (data.assigneeUserId === null) assertCan(ctx, "conversation:assign_self");
  else assertCan(ctx, "conversation:assign_any");
  if (data.assigneeUserId && !(await isActiveMember(ctx.tenantId, data.assigneeUserId))) throw badRequest("El responsable debe ser miembro activo de la empresa.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from conversations where id = ${id} and tenant_id = ${ctx.tenantId} for update`);
    const conv = await tx.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)) });
    if (!conv) throw notFound();
    if (data.expectedVersion !== undefined && data.expectedVersion !== conv.version) {
      // otro cambio concurrente; se informa en lugar de pisar
      if (conv.assigneeUserId && conv.assigneeUserId !== data.assigneeUserId) throw badRequest("La conversación ya fue asignada a otra persona. Recargá para ver el responsable actual.");
    }
    if (ctx.actor.kind === "user" && ctx.actor.role === "agent") {
      if (data.assigneeUserId === null && conv.assigneeUserId !== me) throw forbidden("Solo podés liberar conversaciones propias.");
      if (isSelf && conv.assigneeUserId && conv.assigneeUserId !== me) throw forbidden("La conversación ya tiene responsable. Pedile a un manager que la reasigne.");
    }
    await tx.update(conversations).set({ assigneeUserId: data.assigneeUserId, version: conv.version + 1, updatedAt: new Date() }).where(eq(conversations.id, conv.id));
    await tx.insert(conversationActivity).values({
      tenantId: ctx.tenantId,
      conversationId: conv.id,
      kind: data.assigneeUserId ? "assigned" : "unassigned",
      actorKind: "user",
      actorUserId: me,
      data: { from: conv.assigneeUserId, to: data.assigneeUserId },
    });
    return { assigneeUserId: data.assigneeUserId };
  });
}

export const botControlSchema = z.object({
  mode: z.enum(ATTENTION_MODES),
  reason: z.string().trim().max(200).optional(),
  /** Equipos: con qué bot del equipo se reanuda (por defecto, el que estaba activo). */
  botId: z.string().uuid().optional(),
});

/** Pausar/reanudar bot o pasar a humano. Reanudar el bot solo por acción manual autorizada. */
export async function setAttentionMode(ctx: Ctx, id: string, input: z.input<typeof botControlSchema>) {
  assertCan(ctx, "conversation:bot_control");
  const data = botControlSchema.parse(input);
  if (data.mode === "bot") await assertOperational(ctx.tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from conversations where id = ${id} and tenant_id = ${ctx.tenantId} for update`);
    const conv = await tx.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)) });
    if (!conv) throw notFound();
    if (conv.attentionMode === data.mode) return { attentionMode: conv.attentionMode };
    if (data.mode !== "bot") await cancelActiveRuns(tx, ctx.tenantId, conv.id, data.mode === "paused" ? "Bot pausado manualmente" : "Atención humana");
    const teamPatch: Partial<typeof conversations.$inferInsert> = {};
    if (data.mode === "bot" && conv.teamId && conv.teamVersionId) {
      // reanudar un equipo: todo el equipo vuelve, con el bot elegido o el que estaba activo
      const tv = await loadTeamVersion(ctx.tenantId, conv.teamVersionId);
      const wanted = data.botId ?? conv.activeBotId;
      const node = tv && wanted ? nodeOfBot(tv.graph, wanted) : null;
      const ok = tv && node && teamHelpers(tv).isAvailable(node) ? wanted : tv ? botOfNode(tv.graph, tv.graph.settings.entryNodeId) : null;
      if (data.botId && ok !== data.botId) throw badRequest("Ese bot no está disponible en el equipo de esta conversación.");
      teamPatch.activeBotId = ok;
      teamPatch.botState = { ...((conv.botState ?? {}) as ConversationBotState), transferStreak: 0, unresolvedStreak: 0 };
      if (ok && ok !== conv.activeBotId && tv) await tx.insert(botTransfers).values({ tenantId: ctx.tenantId, conversationId: conv.id, teamId: tv.teamId, teamVersionId: tv.id, fromBotId: conv.activeBotId, toBotId: ok, kind: "manual", reason: "Reanudado manualmente con otro bot del equipo" });
    } else if (data.botId) throw badRequest("Elegir bot solo aplica a conversaciones atendidas por un equipo.");
    await tx.update(conversations).set({ attentionMode: data.mode, ...teamPatch, version: conv.version + 1, updatedAt: new Date() }).where(eq(conversations.id, conv.id));
    await tx.insert(conversationActivity).values({
      tenantId: ctx.tenantId,
      conversationId: conv.id,
      kind: data.mode === "bot" ? "bot_resumed" : data.mode === "paused" ? "bot_paused" : "handoff",
      actorKind: "user",
      actorUserId: actorUserId(ctx),
      reason: data.reason ?? (data.mode === "bot" ? (conv.teamId ? "Equipo de chatbots reanudado manualmente" : "Bot reanudado manualmente") : data.mode === "paused" ? "Bot pausado manualmente" : "Atención humana"),
      data: teamPatch.activeBotId ? { botId: teamPatch.activeBotId } : undefined,
    });
    return { attentionMode: data.mode };
  });
}

export async function setConversationStatus(ctx: Ctx, id: string, status: "open" | "pending" | "resolved") {
  assertCan(ctx, "conversation:status");
  const conv = await loadConv(ctx, id);
  try {
    const { client } = await getTenantChatwoot(ctx.tenantId);
    await client.toggleStatus(conv.chatwootConversationId, status);
  } catch (e) {
    throw upstream(`No se pudo cambiar el estado en el motor de mensajería: ${(e as Error).message}`);
  }
  // al resolver, la conversación deja de usar la versión fijada del equipo (la próxima usa la vigente)
  const unpin = status === "resolved" ? { teamId: null, teamVersionId: null, activeBotId: null } : {};
  await db.update(conversations).set({ status, ...unpin, version: conv.version + 1, updatedAt: new Date() }).where(eq(conversations.id, conv.id));
  await db.insert(conversationActivity).values({ tenantId: ctx.tenantId, conversationId: conv.id, kind: "status_changed", actorKind: "user", actorUserId: actorUserId(ctx), data: { from: conv.status, to: status } });
  // reactivación automática del bot SOLO si el bot publicado tiene la regla explícita "al resolver"
  if (status === "resolved" && (conv.attentionMode === "human" || conv.attentionMode === "requested")) {
    // equipo: la regla del bot que estaba activo (versión fijada); individual: el bot que aplica al número
    const pinned = conv.teamVersionId && conv.activeBotId ? await pinnedBotVersion(ctx.tenantId, conv.teamVersionId, conv.activeBotId) : null;
    const bot = pinned?.bot ?? (await selectBotForConversation(ctx.tenantId, conv.channelConnectionId));
    const version = pinned?.version ?? (bot?.publishedVersionId ? await db.query.botVersions.findFirst({ where: eq(botVersions.id, bot.publishedVersionId) }) : null);
    if (bot && version && settingsFromVersion(bot, version.settings).config.control.autoResume === "on_resolve") {
      const upd = await db
        .update(conversations)
        .set({ attentionMode: "bot", botState: {}, version: sql`${conversations.version} + 1`, updatedAt: new Date() })
        .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, ctx.tenantId), inArray(conversations.attentionMode, ["human", "requested"])))
        .returning({ id: conversations.id });
      if (upd.length) await db.insert(conversationActivity).values({ tenantId: ctx.tenantId, conversationId: conv.id, kind: "bot_resumed", actorKind: "system", reason: "Regla del bot: reanudar al resolver la conversación", data: { botId: bot.id } });
      return { status, attentionMode: upd.length ? "bot" : conv.attentionMode };
    }
  }
  return { status };
}
