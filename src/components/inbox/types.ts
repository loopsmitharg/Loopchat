export type ConvListItem = {
  id: string;
  status: "open" | "pending" | "resolved" | "snoozed";
  attentionMode: "bot" | "requested" | "human" | "paused";
  assigneeUserId: string | null;
  assigneeName: string | null;
  lastMessageAt: string | null;
  lastIncomingAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "in" | "out" | null;
  unreadCount: number;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  lastFailed: boolean;
};

export type ConvList = { items: ConvListItem[]; hasMore: boolean; nextBefore: string | null; counts: { open: number; pending: number; unassigned: number; mine: number } };

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

export type ConvDetail = {
  conversation: ConvListItem & { version: number; chatwootConversationId: number; contactId: string; assigneeName: string | null };
  contact: { id: string; name: string; phoneE164: string | null; email: string | null; tags: string[] } | null;
  thread: ThreadMessage[];
  remoteError: string | null;
  hasOlder: boolean;
  window: { open: boolean; closesAt: string | null; reason: string | null };
  notes: { id: string; body: string; authorName: string | null; createdAt: string }[];
  activity: { id: string; kind: string; actorKind: string; actorName: string | null; reason: string | null; createdAt: string }[];
  opportunities: { id: string; title: string; status: string; amount: string | null; currency: string; stageName: string; stageId: string; pipelineId: string; version: number }[];
  activeRun: { id: string; status: string } | null;
  leadData: LeadValue[];
  handoff: { reason: string | null; code: string | null; at: string } | null;
  /** Equipo de chatbots que atiende la conversación (el bot activo es distinto del responsable). */
  team: { id: string; name: string; version: number; activeBot: { id: string; name: string; role: string } | null; bots: { id: string; name: string; role: string }[] } | null;
};

export type LeadValue = { key: string; label: string; type: "text" | "number" | "choice"; options: string[]; value: string | null; source: "bot" | "user" | null; updatedAt: string | null };

export type Member = { membershipId: string; userId: string; name: string; email: string; role: string; status: string };
