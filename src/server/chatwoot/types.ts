/**
 * Tipos del contrato Chatwoot CE verificados contra el código fuente oficial v4.19.0
 * (app/views/api/v1/models/_message.json.jbuilder, app/models/message.rb#webhook_data,
 * app/presenters/conversations/event_data_presenter.rb, lib/webhooks/trigger.rb).
 * Ver docs/chatwoot-integration.md.
 */

/** API REST: message_type numérico (0 incoming, 1 outgoing, 2 activity, 3 template); created_at UNIX. */
export type CwApiMessage = {
  id: number;
  content: string | null;
  inbox_id: number;
  conversation_id: number;
  message_type: 0 | 1 | 2 | 3;
  content_type: string | null;
  status: "sent" | "delivered" | "read" | "failed" | "progress" | null;
  content_attributes: Record<string, unknown> | null;
  created_at: number;
  private: boolean;
  source_id: string | null;
  echo_id?: string;
  sender?: { id: number; name?: string; type?: string; phone_number?: string | null } | null;
  attachments?: CwAttachment[];
};

export type CwAttachment = {
  id: number;
  message_id?: number;
  file_type: "image" | "audio" | "video" | "file" | "location" | "fallback" | "contact" | string;
  data_url: string | null;
  thumb_url?: string | null;
  file_size?: number | null;
  extension?: string | null;
};

export type CwContactRef = {
  id: number;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  identifier?: string | null;
  type?: string;
};

/** Conversación tal como llega en API (push_data) y en webhooks (webhook_data). */
export type CwConversation = {
  id: number; // display_id
  inbox_id: number;
  status: "open" | "pending" | "resolved" | "snoozed";
  can_reply?: boolean;
  channel?: string;
  contact_inbox?: { source_id?: string | null } | null;
  meta?: { sender?: CwContactRef; assignee?: { id: number; name?: string } | null };
  messages?: CwApiMessage[];
  last_activity_at?: number;
  unread_count?: number;
  account?: { id: number; name?: string };
};

/** Webhook de mensaje: message_type como string; created_at ISO. */
export type CwWebhookMessage = {
  event: "message_created" | "message_updated";
  id: number;
  content: string | null;
  content_type?: string | null;
  content_attributes?: Record<string, unknown> | null;
  message_type: "incoming" | "outgoing" | "activity" | "template";
  private: boolean;
  created_at: string;
  source_id?: string | null;
  sender?: (CwContactRef & { type?: string }) | null;
  account: { id: number; name?: string };
  inbox: { id: number; name?: string };
  conversation: CwConversation;
  attachments?: CwAttachment[];
};

export type CwWebhookConversation = CwConversation & {
  event: "conversation_created" | "conversation_status_changed" | "conversation_updated";
  account: { id: number; name?: string };
  changed_attributes?: unknown;
};

export type CwWebhookPayload = CwWebhookMessage | CwWebhookConversation | { event: string; account?: { id: number } };

export const CW_WEBHOOK_SUBSCRIPTIONS = [
  "message_created",
  "message_updated",
  "conversation_created",
  "conversation_status_changed",
  "conversation_updated",
] as const;
