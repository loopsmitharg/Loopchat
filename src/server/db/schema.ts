import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Better Auth (tablas requeridas por la librería)                      */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Plataforma / tenants                                                */
/* ------------------------------------------------------------------ */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  timezone: text("timezone").notNull().default("America/Argentina/Buenos_Aires"),
  defaultCurrency: text("default_currency").notNull().default("ARS"),
  settings: jsonb("settings")
    .$type<TenantSettings>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type TenantSettings = {
  autoCreateOpportunity?: boolean;
  businessHours?: { enabled: boolean; days: number[]; start: string; end: string };
  outOfHoursMessage?: string;
};

export const platformAdmins = pgTable("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const ROLES = ["tenant_admin", "manager", "agent", "viewer"] as const;
export type TenantRole = (typeof ROLES)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_tenant_idx").on(t.tenantId)],
);

export type PlanLimits = {
  whatsappNumbers: number;
  agents: number;
  pipelines: number | null; // null = uso justo (sin tope duro)
  activeBots: number;
  aiCallsPerMonth: number;
  editor: "basic" | "full";
};

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  limits: jsonb("limits").$type<PlanLimits>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("trial"),
  limitOverrides: jsonb("limit_overrides").$type<Partial<PlanLimits>>(),
  notes: text("notes"),
  trialEndsAt: ts("trial_ends_at"),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const usageCounters = pgTable(
  "usage_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM (UTC)
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.period, t.metric] })],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    period: text("period").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome", { enum: ["reserved", "success", "failure", "blocked"] }).notNull(),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    detail: text("detail"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("usage_events_idem_uq").on(t.tenantId, t.idempotencyKey),
    index("usage_events_tenant_period_idx").on(t.tenantId, t.period, t.metric),
  ],
);

/* ------------------------------------------------------------------ */
/* Integraciones                                                        */
/* ------------------------------------------------------------------ */

export const chatwootAccounts = pgTable("chatwoot_accounts", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  chatwootAccountId: integer("chatwoot_account_id").notNull().unique(),
  serviceUserId: integer("service_user_id"),
  apiTokenEnc: text("api_token_enc").notNull(),
  webhookId: integer("webhook_id"),
  webhookSecretEnc: text("webhook_secret_enc"),
  webhookKey: text("webhook_key").notNull().unique(), // identificador opaco en la URL del webhook
  provisionedBy: text("provisioned_by", { enum: ["platform_api", "manual"] }).notNull(),
  status: text("status", { enum: ["ready", "error"] }).notNull().default("ready"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["whatsapp_cloud"] }).notNull().default("whatsapp_cloud"),
    displayName: text("display_name").notNull(),
    phoneNumber: text("phone_number").notNull(), // E.164
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    tokenHint: text("token_hint").notNull(),
    chatwootInboxId: integer("chatwoot_inbox_id"),
    status: text("status", {
      enum: ["pending_verification", "connected", "error", "disconnected"],
    })
      .notNull()
      .default("pending_verification"),
    lastVerifiedAt: ts("last_verified_at"),
    lastError: text("last_error"),
    tokenRotatedAt: ts("token_rotated_at"),
    billingOwnerConfirmed: boolean("billing_owner_confirmed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("channel_connections_tenant_idx").on(t.tenantId),
    // un phone_number_id de Meta no puede pertenecer a dos empresas
    uniqueIndex("channel_connections_phone_number_id_uq").on(t.phoneNumberId),
  ],
);

export const AI_PROVIDERS = ["openai_compatible", "anthropic", "gemini"] as const;
export type AiProviderKind = (typeof AI_PROVIDERS)[number];

export const aiProviderConnections = pgTable(
  "ai_provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_PROVIDERS }).notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url"),
    apiKeyEnc: text("api_key_enc").notNull(),
    keyHint: text("key_hint").notNull(),
    defaultModel: text("default_model").notNull(),
    status: text("status", { enum: ["unverified", "verified", "error", "revoked"] })
      .notNull()
      .default("unverified"),
    lastVerifiedAt: ts("last_verified_at"),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conn_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* CRM                                                                  */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneE164: text("phone_e164"),
    channelConnectionId: uuid("channel_connection_id").references(() => channelConnections.id, {
      onDelete: "set null",
    }),
    chatwootContactId: integer("chatwoot_contact_id"),
    email: text("email"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    // datos comerciales recopilados (claves = lead_fields.key de la empresa)
    leadData: jsonb("lead_data").$type<LeadData>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_tenant_idx").on(t.tenantId),
    uniqueIndex("contacts_identity_uq")
      .on(t.tenantId, t.channelConnectionId, t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
  ],
);

export type LeadData = Record<string, { value: string; updatedAt: string; source: "bot" | "user" }>;
export type ConversationBotState = {
  welcomedAt?: string;
  outOfHoursNotifiedAt?: string;
  unresolvedStreak?: number;
  productIds?: string[];
  /** transferencias internas consecutivas sin que un bot responda (protección contra bucles) */
  transferStreak?: number;
  /** último traspaso interno (resumen estructurado, sin IA) para el bot que recibe */
  transfer?: { fromBotId: string | null; toBotId: string; at: string; note: string };
};

export type PendingBotMessage = { chatwootMessageId: number; text: string; hasAttachments: boolean; at: string };

export const CONVERSATION_STATUSES = ["open", "pending", "resolved", "snoozed"] as const;
export const ATTENTION_MODES = ["bot", "requested", "human", "paused"] as const;
export type AttentionMode = (typeof ATTENTION_MODES)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    chatwootConversationId: integer("chatwoot_conversation_id").notNull(),
    chatwootInboxId: integer("chatwoot_inbox_id"),
    channelConnectionId: uuid("channel_connection_id").references(() => channelConnections.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status", { enum: CONVERSATION_STATUSES }).notNull().default("open"),
    attentionMode: text("attention_mode", { enum: ATTENTION_MODES }).notNull().default("bot"),
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    lastIncomingAt: ts("last_incoming_at"),
    lastMessageAt: ts("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageDirection: text("last_message_direction", { enum: ["in", "out"] }),
    firstResponseAt: ts("first_response_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    // estado del bot en la conversación (bienvenida, intentos sin resolver, productos consultados)
    botState: jsonb("bot_state").$type<ConversationBotState>().notNull().default(sql`'{}'::jsonb`),
    // equipo de chatbots: versión fijada para esta conversación y bot activo (uno solo a la vez)
    teamId: uuid("team_id"),
    teamVersionId: uuid("team_version_id"),
    activeBotId: uuid("active_bot_id"),
    // último mensaje del cliente que llegó mientras el bot procesaba otro: se procesa al terminar (no se pierde)
    pendingBotMessage: jsonb("pending_bot_message").$type<PendingBotMessage | null>(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conversations_cw_uq").on(t.tenantId, t.chatwootConversationId),
    index("conversations_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
    index("conversations_contact_idx").on(t.contactId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    chatwootMessageId: integer("chatwoot_message_id"),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    senderKind: text("sender_kind", { enum: ["contact", "agent", "bot", "system"] }).notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status", { enum: ["pending", "sending", "sent", "delivered", "read", "failed", "cancelled"] }).notNull(),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    // Texto solo mientras el envío está pendiente/fallido (para reintentar); se borra al confirmarse.
    pendingContent: text("pending_content"),
    isTemplate: boolean("is_template").notNull().default(false),
    origin: jsonb("origin").$type<{ botId?: string; versionId?: string; runId?: string; provider?: string; model?: string; attachment?: { productId: string }; template?: { name: string; language: string; params: string[] } }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("messages_cw_uq").on(t.tenantId, t.chatwootMessageId),
    uniqueIndex("messages_idem_uq").on(t.tenantId, t.idempotencyKey),
    index("messages_conv_idx").on(t.conversationId, t.createdAt),
  ],
);

export const conversationActivity = pgTable(
  "conversation_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // assigned | unassigned | handoff | bot_resumed | bot_paused | status_changed | bot_transfer
    actorKind: text("actor_kind", { enum: ["user", "bot", "system"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("conv_activity_conv_idx").on(t.conversationId, t.createdAt)],
);

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id"),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("notes_tenant_idx").on(t.tenantId)],
);

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pipelines_tenant_idx").on(t.tenantId)],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("stages_pipeline_idx").on(t.pipelineId, t.position)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("ARS"),
    source: text("source").notNull().default("manual"),
    // productos del catálogo por los que se interesó (asociados por el bot o el equipo)
    productIds: text("product_ids").array().notNull().default(sql`'{}'::text[]`),
    followUpAt: ts("follow_up_at"),
    lostReason: text("lost_reason"),
    closedAt: ts("closed_at"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opps_tenant_stage_idx").on(t.tenantId, t.stageId),
    index("opps_contact_idx").on(t.contactId),
  ],
);

export const opportunityHistory = pgTable(
  "opportunity_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    actorKind: text("actor_kind", { enum: ["user", "bot", "system"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    createdAt: createdAt(),
  },
  (t) => [index("opp_history_opp_idx").on(t.opportunityId, t.createdAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    dueAt: ts("due_at"),
    status: text("status", { enum: ["pending", "done", "cancelled"] }).notNull().default("pending"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    createdByKind: text("created_by_kind", { enum: ["user", "bot"] }).notNull().default("user"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: ts("completed_at"),
    // acciones de bots: clave estable por ejecución/paso para que un reintento no duplique la tarea
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_tenant_status_idx").on(t.tenantId, t.status, t.dueAt), uniqueIndex("tasks_idem_uq").on(t.tenantId, t.idempotencyKey)],
);

/* ------------------------------------------------------------------ */
/* Bots, flujos y conocimiento                                          */
/* ------------------------------------------------------------------ */

export const BOT_ROLES = ["receptionist", "sales", "customer_service", "support", "followup", "aftersales", "custom"] as const;
export type BotRole = (typeof BOT_ROLES)[number];

export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: text("mode", { enum: ["instructions", "flow"] }).notNull().default("instructions"),
    // rol dentro de un equipo (plantilla de origen); "custom" = sin rol especial
    role: text("role", { enum: BOT_ROLES }).notNull().default("custom"),
    status: text("status", { enum: ["inactive", "active"] }).notNull().default("inactive"),
    aiConnectionId: uuid("ai_connection_id").references(() => aiProviderConnections.id, { onDelete: "set null" }),
    model: text("model"),
    // null = aplica a todos los números de la empresa
    channelConnectionId: uuid("channel_connection_id").references(() => channelConnections.id, { onDelete: "set null" }),
    instructions: text("instructions").notNull().default(""),
    allowedTools: text("allowed_tools").array().notNull().default(sql`'{}'::text[]`),
    handoffKeywords: text("handoff_keywords").array().notNull().default(sql`'{}'::text[]`),
    // configuración extendida (derivación, personalidad, reglas de herramientas, catálogo, objetivos)
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    draftGraph: jsonb("draft_graph").$type<unknown>(),
    draftRevision: integer("draft_revision").notNull().default(0),
    publishedVersionId: uuid("published_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bots_tenant_idx").on(t.tenantId)],
);

export const botVersions = pgTable(
  "bot_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graph: jsonb("graph").$type<unknown>().notNull(),
    // copia inmutable de la configuración al publicar (instrucciones, herramientas, reglas, productos)
    settings: jsonb("settings").$type<Record<string, unknown>>(),
    checksum: text("checksum").notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: ts("published_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bot_versions_uq").on(t.botId, t.version)],
);

export const FLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "handed_off",
] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];

export const flowRuns = pgTable(
  "flow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => botVersions.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    triggerKey: text("trigger_key").notNull(),
    status: text("status", { enum: FLOW_RUN_STATUSES }).notNull().default("queued"),
    currentNodeId: text("current_node_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    stepCount: integer("step_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    resumeAt: ts("resume_at"),
    lastError: text("last_error"),
    // diagnóstico: llamadas a IA, tokens, latencia, herramientas ejecutadas/bloqueadas, motivo de derivación
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: ts("started_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
    // lease del proceso que la ejecuta: otro worker solo puede retomarla si venció (sin doble ejecución)
    leaseOwner: text("lease_owner"),
    leaseUntil: ts("lease_until"),
  },
  (t) => [
    uniqueIndex("flow_runs_trigger_uq").on(t.tenantId, t.triggerKey),
    uniqueIndex("flow_runs_active_conv_uq").on(t.conversationId).where(sql`status in ('queued', 'running')`),
    index("flow_runs_conv_idx").on(t.conversationId, t.status),
    index("flow_runs_resume_idx").on(t.status, t.resumeAt),
  ],
);

export const flowRunSteps = pgTable(
  "flow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => flowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    status: text("status", { enum: ["completed", "failed", "skipped"] }).notNull(),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (t) => [index("flow_run_steps_run_idx").on(t.runId, t.createdAt)],
);


/* ------------------------------------------------------------------ */
/* Identidad, objetivos y reglas de IA de la empresa                    */
/* ------------------------------------------------------------------ */

/** Perfil de IA de la empresa (identidad, objetivos, personalidad de marca). Uno por empresa. */
export const tenantAiProfiles = pgTable("tenant_ai_profiles", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/** Reglas generales de la empresa. Las obligatorias se aplican en vivo y ningún bot las puede desactivar. */
export const tenantAiRules = pgTable(
  "tenant_ai_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category").notNull().default("other"),
    enabled: boolean("enabled").notNull().default(true),
    mandatory: boolean("mandatory").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tenant_ai_rules_tenant_idx").on(t.tenantId, t.position)],
);

/** Plantillas de personalidad propias de cada empresa. */
export const aiPersonalityTemplates = pgTable(
  "ai_personality_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    personality: jsonb("personality").$type<Record<string, unknown>>().notNull(),
    behavior: jsonb("behavior").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_personality_templates_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* Equipos de chatbots                                                  */
/* ------------------------------------------------------------------ */

export const botTeams = pgTable(
  "bot_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // null = aplica a todos los números de la empresa
    channelConnectionId: uuid("channel_connection_id").references(() => channelConnections.id, { onDelete: "set null" }),
    status: text("status", { enum: ["inactive", "active"] }).notNull().default("inactive"),
    draftGraph: jsonb("draft_graph").$type<unknown>().notNull(),
    draftRevision: integer("draft_revision").notNull().default(0),
    publishedVersionId: uuid("published_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bot_teams_tenant_idx").on(t.tenantId)],
);

export const botTeamVersions = pgTable(
  "bot_team_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => botTeams.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graph: jsonb("graph").$type<unknown>().notNull(),
    // versión publicada de cada bot fijada al publicar el equipo: { [botId]: botVersionId }
    botVersions: jsonb("bot_versions").$type<Record<string, string>>().notNull(),
    checksum: text("checksum").notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: ts("published_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bot_team_versions_uq").on(t.teamId, t.version)],
);

/** Bots de la versión publicada de cada equipo (para cupos y para impedir borrar bots en uso). */
export const botTeamMembers = pgTable(
  "bot_team_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => botTeams.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.botId] }), index("bot_team_members_bot_idx").on(t.botId)],
);

/** Registro trazable de cada derivación interna (bot → bot, bot → humano, automatizaciones). */
export const botTransfers = pgTable(
  "bot_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => botTeams.id, { onDelete: "set null" }),
    teamVersionId: uuid("team_version_id"),
    fromBotId: uuid("from_bot_id").references(() => bots.id, { onDelete: "set null" }),
    toBotId: uuid("to_bot_id").references(() => bots.id, { onDelete: "set null" }),
    toHuman: boolean("to_human").notNull().default(false),
    kind: text("kind").notNull(), // keyword | intent | ai | unknown | unavailable | fallback | automation | loop_guard
    intent: text("intent"),
    reason: text("reason").notNull(),
    runId: uuid("run_id"),
    createdAt: createdAt(),
  },
  (t) => [index("bot_transfers_conv_idx").on(t.conversationId, t.createdAt), index("bot_transfers_team_idx").on(t.teamId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Catálogo de productos y datos comerciales                            */
/* ------------------------------------------------------------------ */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // null = precio no informado (el bot no lo inventa)
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("ARS"),
    // null = stock sin especificar; 0 = sin stock
    stock: integer("stock"),
    active: boolean("active").notNull().default(true),
    archivedAt: ts("archived_at"),
    photoPath: text("photo_path"),
    photoMime: text("photo_mime"),
    photoSize: integer("photo_size"),
    photoSha256: text("photo_sha256"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_tenant_idx").on(t.tenantId, t.archivedAt)],
);

export const botProducts = pgTable(
  "bot_products",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.productId] }), index("bot_products_product_idx").on(t.productId)],
);

export const LEAD_FIELD_TYPES = ["text", "number", "choice"] as const;

export const leadFields = pgTable(
  "lead_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: LEAD_FIELD_TYPES }).notNull().default("text"),
    options: text("options").array().notNull().default(sql`'{}'::text[]`),
    hint: text("hint"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lead_fields_key_uq").on(t.tenantId, t.key)],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["faq", "text", "file"] }).notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["ready", "failed"] }).notNull(),
    error: text("error"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    storagePath: text("storage_path"),
    charCount: integer("char_count").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("knowledge_sources_tenant_idx").on(t.tenantId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('spanish', content)`),
  },
  (t) => [
    index("knowledge_chunks_tenant_idx").on(t.tenantId),
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

/* ------------------------------------------------------------------ */
/* Operación                                                            */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorKind: text("actor_kind", { enum: ["user", "bot", "system", "platform"] }).notNull().default("user"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("chatwoot"),
    deliveryId: text("delivery_id"),
    dedupKey: text("dedup_key").notNull().unique(),
    event: text("event").notNull(),
    status: text("status", { enum: ["received", "processed", "failed", "ignored"] }).notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    payload: jsonb("payload").$type<unknown>(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("webhook_events_status_idx").on(t.status, t.receivedAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupKey: text("dedup_key").unique(),
    status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedUntil: ts("locked_until"),
    // worker que tiene el lease (fencing): solo él puede completar/fallar el trabajo
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_pick_idx").on(t.status, t.runAt), index("jobs_tenant_running_idx").on(t.tenantId, t.status)],
);

/** Resultado de una generación de IA ya pagada: un reintento del mismo paso lo reutiliza en lugar de volver a llamar. */
export const aiTurnResults = pgTable("ai_turn_results", {
  key: text("key").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const devMailOutbox = pgTable("dev_mail_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});
