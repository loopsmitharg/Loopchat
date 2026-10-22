import "server-only";
import { assertSafeOutboundUrl } from "../http/ssrf";
import type { CwApiMessage, CwConversation } from "./types";

export class ChatwootError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type ReqOpts = { timeoutMs?: number };

async function request<T>(baseUrl: string, token: string, method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<T> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { api_access_token: token, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (e) {
    throw new ChatwootError(0, `Chatwoot no responde (${(e as Error).name === "AbortError" ? "timeout" : "red"})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message ?? (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ChatwootError(res.status, `Chatwoot: ${msg}`, json);
  }
  return json as T;
}

/** POST multipart (mensajes con adjuntos, como la API de Chatwoot). */
async function requestForm<T>(baseUrl: string, token: string, path: string, form: FormData, opts: ReqOpts = {}): Promise<T> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { api_access_token: token, accept: "application/json" }, body: form, signal: controller.signal, redirect: "error" });
  } catch (e) {
    throw new ChatwootError(0, `Chatwoot no responde (${(e as Error).name === "AbortError" ? "timeout" : "red"})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message ?? (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ChatwootError(res.status, `Chatwoot: ${msg}`, json);
  }
  return json as T;
}

/** Cliente de la Application API, siempre ligado a UNA cuenta (la del tenant). */
export class ChatwootAccountClient {
  constructor(private baseUrl: string, private token: string, public readonly accountId: number) {
    assertSafeOutboundUrl(baseUrl, { purpose: "chatwoot" });
  }
  private p(path: string) {
    return `api/v1/accounts/${this.accountId}/${path}`;
  }
  private r<T>(method: string, path: string, body?: unknown) {
    return request<T>(this.baseUrl, this.token, method, this.p(path), body);
  }

  listConversations(params: { status?: string; page?: number } = {}) {
    const q = new URLSearchParams({ status: params.status ?? "all", assignee_type: "all", page: String(params.page ?? 1) });
    return this.r<{ data: { meta: Record<string, number>; payload: CwConversation[] } }>("GET", `conversations?${q}`);
  }
  getConversation(conversationId: number) {
    return this.r<CwConversation>("GET", `conversations/${conversationId}`);
  }
  listMessages(conversationId: number, before?: number) {
    const q = before ? `?before=${before}` : "";
    return this.r<{ meta: Record<string, unknown>; payload: CwApiMessage[] }>("GET", `conversations/${conversationId}/messages${q}`);
  }
  sendMessage(conversationId: number, input: { content?: string; private?: boolean; contentAttributes?: Record<string, unknown>; templateParams?: Record<string, unknown> }) {
    return this.r<CwApiMessage>("POST", `conversations/${conversationId}/messages`, {
      content: input.content,
      message_type: "outgoing",
      private: input.private ?? false,
      content_attributes: input.contentAttributes,
      template_params: input.templateParams,
    });
  }
  /** Mensaje saliente con una imagen adjunta (multipart: attachments[]). */
  sendAttachment(conversationId: number, input: { content?: string; file: { bytes: Buffer; mime: string; name: string }; contentAttributes?: Record<string, string> }) {
    const form = new FormData();
    if (input.content) form.append("content", input.content);
    form.append("message_type", "outgoing");
    form.append("private", "false");
    for (const [k, v] of Object.entries(input.contentAttributes ?? {})) form.append(`content_attributes[${k}]`, v);
    form.append("attachments[]", new Blob([new Uint8Array(input.file.bytes)], { type: input.file.mime }), input.file.name);
    return requestForm<CwApiMessage>(this.baseUrl, this.token, this.p(`conversations/${conversationId}/messages`), form);
  }
  toggleStatus(conversationId: number, status: "open" | "resolved" | "pending") {
    return this.r<unknown>("POST", `conversations/${conversationId}/toggle_status`, { status });
  }
  getInbox(inboxId: number) {
    return this.r<{ id: number; name: string; channel_type: string; phone_number?: string; message_templates?: unknown[]; provider_config?: Record<string, unknown> }>("GET", `inboxes/${inboxId}`);
  }
  createWhatsappInbox(input: { name: string; phoneNumber: string; apiKey: string; phoneNumberId: string; businessAccountId: string }) {
    return this.r<{ id: number; name: string }>("POST", "inboxes", {
      name: input.name,
      channel: {
        type: "whatsapp",
        phone_number: input.phoneNumber,
        provider: "whatsapp_cloud",
        provider_config: { api_key: input.apiKey, phone_number_id: input.phoneNumberId, business_account_id: input.businessAccountId },
      },
    });
  }
  updateWhatsappInboxToken(inboxId: number, input: { apiKey: string; phoneNumberId: string; businessAccountId: string }) {
    return this.r<unknown>("PATCH", `inboxes/${inboxId}`, {
      channel: { provider_config: { api_key: input.apiKey, phone_number_id: input.phoneNumberId, business_account_id: input.businessAccountId } },
    });
  }
  deleteInbox(inboxId: number) {
    return this.r<unknown>("DELETE", `inboxes/${inboxId}`);
  }
  listWebhooks() {
    return this.r<{ payload: { webhooks?: { id: number; url: string; secret?: string; subscriptions: string[] }[] } | { id: number; url: string }[] }>("GET", "webhooks");
  }
  createWebhook(url: string, subscriptions: readonly string[]) {
    return this.r<{ payload: { webhook: { id: number; url: string; secret?: string; subscriptions: string[] } } }>("POST", "webhooks", {
      webhook: { url, subscriptions, name: "Loopchat" },
    });
  }
  deleteWebhook(id: number) {
    return this.r<unknown>("DELETE", `webhooks/${id}`);
  }
}

/** Platform API: solo administra cuentas/usuarios creados por la misma Platform App. */
export class ChatwootPlatformClient {
  constructor(private baseUrl: string, private token: string) {
    assertSafeOutboundUrl(baseUrl, { purpose: "chatwoot" });
  }
  createAccount(name: string) {
    return request<{ id: number; name: string }>(this.baseUrl, this.token, "POST", "platform/api/v1/accounts", { name });
  }
  getAccount(id: number) {
    return request<{ id: number; name: string }>(this.baseUrl, this.token, "GET", `platform/api/v1/accounts/${id}`);
  }
  createUser(input: { name: string; email: string; password: string }) {
    return request<{ id: number; access_token: string; email: string }>(this.baseUrl, this.token, "POST", "platform/api/v1/users", {
      name: input.name,
      email: input.email,
      password: input.password,
      custom_attributes: { managed_by: "loopchat" },
    });
  }
  addAccountUser(accountId: number, userId: number, role: "administrator" | "agent") {
    return request<unknown>(this.baseUrl, this.token, "POST", `platform/api/v1/accounts/${accountId}/account_users`, { user_id: userId, role });
  }
}

export function chatwootBaseUrl(): string {
  const url = process.env.CHATWOOT_BASE_URL;
  if (!url) throw new ChatwootError(0, "CHATWOOT_BASE_URL no configurado");
  return url;
}
