/**
 * SIMULADOR DE CONTRATO de Chatwoot CE (solo desarrollo/tests). NO es Chatwoot.
 *
 * Reproduce el subconjunto de la Platform API y Application API que usa Loopchat, con los
 * formatos verificados contra el código fuente oficial v4.19.0, y emite webhooks firmados
 * igual que lib/webhooks/trigger.rb. Sirve para tests E2E reproducibles sin Docker ni Meta.
 * Las pruebas reales contra Chatwoot/Meta se documentan aparte (docs/qa-final.md).
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";

type Msg = { id: number; content: string | null; message_type: 0 | 1 | 2 | 3; created_at: number; private: boolean; status: string; content_attributes: Record<string, unknown>; source_id: string | null; sender: Record<string, unknown> | null; attachments?: unknown[] };
type Conv = { id: number; account_id: number; inbox_id: number; contact_id: number; status: "open" | "pending" | "resolved"; messages: Msg[]; last_incoming_at: number | null };
type Contact = { id: number; name: string; phone_number: string };
type Account = { id: number; name: string; created_by_platform: boolean; webhooks: { id: number; url: string; secret: string; subscriptions: string[] }[]; inboxes: { id: number; name: string; phone_number: string; provider_config: Record<string, unknown> }[]; conversations: Conv[]; contacts: Contact[]; users: number[] };

const PLATFORM_TOKEN = process.env.CHATWOOT_SIM_PLATFORM_TOKEN ?? "sim-platform-token";
const PORT = Number(process.env.CHATWOOT_SIM_PORT ?? 3011);
let seq = 100;
const nextId = () => ++seq;
const accounts = new Map<number, Account>();
const users = new Map<number, { id: number; email: string; token: string }>();
const deliveries: { url: string; event: string; status: number | string }[] = [];
let failNextSend = false;

/** Plantillas de la WABA tal como las guarda Chatwoot (respuesta de Meta /message_templates). Fixture del simulador. */
const SIM_TEMPLATES = [
  { name: "seguimiento_consulta", language: "es_AR", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hola {{1}}, te escribimos por tu consulta sobre {{2}}. ¿Seguimos por acá?" }] },
  { name: "recordatorio_pago", language: "es_AR", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, te recordamos tu pago." }] },
  { name: "promo_con_imagen", language: "es_AR", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Novedades para vos, {{1}}." }] },
];
/** Como Whatsapp::TemplateProcessorService: solo plantillas APPROVED por nombre + idioma; sin coincidencia Meta la rechaza. */
const approvedTemplate = (tp: Record<string, unknown>) => SIM_TEMPLATES.find((t) => t.name === tp.name && t.language.toLowerCase() === String(tp.language ?? "").toLowerCase() && t.status === "APPROVED");

// Persistencia opcional (demo local): `--state <archivo>` guarda cuentas/bandejas/conversaciones
// para que reiniciar el simulador no lo deje desincronizado de la base de Loopchat. Los tests no la usan.
const stateArg = process.argv.indexOf("--state");
const STATE_FILE = stateArg > -1 ? process.argv[stateArg + 1] : undefined;
type Persisted = { seq: number; accounts: Account[]; users: { id: number; email: string; token: string }[] };
if (STATE_FILE && existsSync(STATE_FILE)) {
  const st = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Persisted;
  seq = st.seq;
  for (const a of st.accounts) accounts.set(a.id, a);
  for (const u of st.users) users.set(u.id, u);
  console.log(`[chatwoot-sim] estado cargado de ${STATE_FILE} (${accounts.size} cuentas)`);
}
function saveState() {
  if (!STATE_FILE) return;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const st: Persisted = { seq, accounts: [...accounts.values()], users: [...users.values()] };
  writeFileSync(STATE_FILE, JSON.stringify(st));
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  const ct = String(req.headers["content-type"] ?? "");
  if (ct.startsWith("multipart/form-data")) {
    // como Chatwoot: mensajes con adjuntos llegan en multipart (attachments[] + content_attributes[clave])
    const form = await new Request("http://sim.local", { method: "POST", headers: { "content-type": ct }, body: buf }).formData();
    const out: Record<string, unknown> = { attachments: [] as { file_type: string; file_size: number; name: string }[] };
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v !== "string") (out.attachments as { file_type: string; file_size: number; name: string }[]).push({ file_type: v.type.startsWith("image/") ? "image" : "file", file_size: v.size, name: v.name });
      else if (k.startsWith("content_attributes[")) attrs[k.slice(19, -1)] = v;
      else out[k] = v === "true" ? true : v === "false" ? false : v;
    }
    out.content_attributes = attrs;
    return out;
  }
  const raw = buf.toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
function userByToken(token: string | undefined) {
  for (const u of users.values()) if (u.token === token) return u;
  return null;
}

function contactRef(acc: Account, contactId: number) {
  const c = acc.contacts.find((x) => x.id === contactId)!;
  return { id: c.id, name: c.name, phone_number: c.phone_number, email: null, identifier: null, type: "contact" };
}
function convPushData(acc: Account, conv: Conv) {
  const last = conv.messages.filter((m) => !m.private).at(-1);
  const canReply = conv.last_incoming_at !== null && Date.now() / 1000 - conv.last_incoming_at < 86400;
  return {
    id: conv.id,
    inbox_id: conv.inbox_id,
    status: conv.status,
    can_reply: canReply,
    channel: "Channel::Whatsapp",
    contact_inbox: { source_id: acc.contacts.find((c) => c.id === conv.contact_id)!.phone_number.replace("+", "") },
    meta: { sender: contactRef(acc, conv.contact_id), assignee: null },
    messages: last ? [apiMsg(conv, last)] : [],
    last_activity_at: last?.created_at ?? 0,
    unread_count: 0,
    account: { id: acc.id, name: acc.name },
  };
}
function apiMsg(conv: Conv, m: Msg) {
  return { ...m, inbox_id: conv.inbox_id, conversation_id: conv.id, content_type: "text" };
}
function webhookMsg(acc: Account, conv: Conv, m: Msg, event: string) {
  const types = ["incoming", "outgoing", "activity", "template"];
  return {
    event,
    account: { id: acc.id, name: acc.name },
    additional_attributes: {},
    content_attributes: m.content_attributes,
    content_type: "text",
    content: m.content,
    conversation: convPushData(acc, conv),
    created_at: new Date(m.created_at * 1000).toISOString(),
    id: m.id,
    inbox: { id: conv.inbox_id, name: acc.inboxes.find((i) => i.id === conv.inbox_id)?.name ?? "" },
    message_type: types[m.message_type],
    private: m.private,
    sender: m.sender,
    source_id: m.source_id,
    ...(m.attachments ? { attachments: m.attachments } : {}),
  };
}

async function emit(acc: Account, payload: Record<string, unknown>) {
  for (const wh of acc.webhooks) {
    if (!wh.subscriptions.includes(String(payload.event))) continue;
    const raw = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "X-Chatwoot-Delivery": randomUUID(),
      "X-Chatwoot-Timestamp": ts,
      "X-Chatwoot-Signature": "sha256=" + createHmac("sha256", wh.secret).update(`${ts}.${raw}`).digest("hex"),
    };
    try {
      const r = await fetch(wh.url, { method: "POST", headers, body: raw });
      deliveries.push({ url: wh.url, event: String(payload.event), status: r.status });
      // emula el reintento de Sidekiq: misma entrega (mismo delivery id) si falla
      if (r.status >= 500) await fetch(wh.url, { method: "POST", headers, body: raw });
    } catch (e) {
      deliveries.push({ url: wh.url, event: String(payload.event), status: String((e as Error).message) });
    }
  }
}

const server = createServer(async (req, res) => {
  if (STATE_FILE && req.method !== "GET") res.on("finish", saveState);
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const p = url.pathname;
    const token = req.headers["api_access_token"] as string | undefined;

    // ---------- controles del simulador ----------
    if (p === "/__sim/health") return json(res, 200, { ok: true, simulator: true });
    if (p === "/__sim/state") return json(res, 200, { accounts: [...accounts.values()].map((a) => ({ ...a, webhooks: a.webhooks.map((w) => ({ ...w, secret: "[oculto]" })) })), deliveries });
    if (p === "/__sim/reset" && req.method === "POST") {
      accounts.clear();
      users.clear();
      deliveries.length = 0;
      return json(res, 200, { ok: true });
    }
    if (p === "/__sim/fail-next-send" && req.method === "POST") {
      failNextSend = true;
      return json(res, 200, { ok: true });
    }
    if (p === "/__sim/incoming" && req.method === "POST") {
      const b = await body(req);
      const acc = accounts.get(Number(b.accountId));
      if (!acc) return json(res, 404, { error: "account" });
      const inbox = b.inboxId ? acc.inboxes.find((i) => i.id === Number(b.inboxId)) : acc.inboxes[0];
      if (!inbox) return json(res, 404, { error: "inbox" });
      let contact = acc.contacts.find((c) => c.phone_number === b.phone);
      if (!contact) {
        contact = { id: nextId(), name: String(b.name ?? b.phone), phone_number: String(b.phone) };
        acc.contacts.push(contact);
      }
      let conv = acc.conversations.find((c) => c.contact_id === contact!.id && c.inbox_id === inbox.id && c.status !== "resolved");
      let created = false;
      if (!conv) {
        conv = { id: acc.conversations.length + 1, account_id: acc.id, inbox_id: inbox.id, contact_id: contact.id, status: "open", messages: [], last_incoming_at: null };
        acc.conversations.push(conv);
        created = true;
      }
      const at = b.ageSeconds ? Math.floor(Date.now() / 1000) - Number(b.ageSeconds) : Math.floor(Date.now() / 1000);
      const m: Msg = { id: nextId(), content: (b.content as string) ?? null, message_type: 0, created_at: at, private: false, status: "sent", content_attributes: {}, source_id: `wamid.${randomBytes(6).toString("hex")}`, sender: contactRef(acc, contact.id), attachments: b.attachment ? [{ id: nextId(), file_type: "image", data_url: "https://example.invalid/demo.jpg", thumb_url: null, file_size: 1234 }] : undefined };
      conv.messages.push(m);
      conv.last_incoming_at = at;
      if (conv.status === "resolved") conv.status = "open";
      if (created) await emit(acc, { event: "conversation_created", ...convPushData(acc, conv) });
      await emit(acc, webhookMsg(acc, conv, m, "message_created"));
      if (b.duplicateDelivery) await emit(acc, webhookMsg(acc, conv, m, "message_created"));
      return json(res, 200, { conversationId: conv.id, messageId: m.id });
    }
    if (p === "/__sim/status" && req.method === "POST") {
      const b = await body(req);
      const acc = accounts.get(Number(b.accountId));
      const conv = acc?.conversations.find((c) => c.messages.some((m) => m.id === Number(b.messageId)));
      const m = conv?.messages.find((x) => x.id === Number(b.messageId));
      if (!acc || !conv || !m) return json(res, 404, { error: "message" });
      m.status = String(b.status);
      if (b.error) m.content_attributes = { ...m.content_attributes, external_error: b.error };
      await emit(acc, webhookMsg(acc, conv, m, "message_updated"));
      return json(res, 200, { ok: true });
    }

    // ---------- Graph API de Meta (simulada, solo lectura) ----------
    const mg = p.match(/^\/meta-graph\/v[\d.]+\/(\d+)$/);
    if (mg) {
      const auth = String(req.headers.authorization ?? "");
      if (!auth.startsWith("Bearer EAA")) return json(res, 400, { error: { message: "Invalid OAuth access token (simulado)" } });
      return json(res, 200, { display_phone_number: "+54 9 11 5555-0000", verified_name: "Empresa Demo", quality_rating: "GREEN", id: mg[1] });
    }

    // ---------- Platform API ----------
    if (p.startsWith("/platform/api/v1/")) {
      if (token !== PLATFORM_TOKEN) return json(res, 401, { error: "Invalid platform token" });
      if (p === "/platform/api/v1/accounts" && req.method === "POST") {
        const b = await body(req);
        const acc: Account = { id: nextId(), name: String(b.name), created_by_platform: true, webhooks: [], inboxes: [], conversations: [], contacts: [], users: [] };
        accounts.set(acc.id, acc);
        return json(res, 200, { id: acc.id, name: acc.name });
      }
      if (p === "/platform/api/v1/users" && req.method === "POST") {
        const b = await body(req);
        const u = { id: nextId(), email: String(b.email), token: randomBytes(12).toString("hex") };
        users.set(u.id, u);
        return json(res, 200, { id: u.id, email: u.email, access_token: u.token, name: b.name });
      }
      const m = p.match(/^\/platform\/api\/v1\/accounts\/(\d+)\/account_users$/);
      if (m && req.method === "POST") {
        const acc = accounts.get(Number(m[1]));
        if (!acc || !acc.created_by_platform) return json(res, 401, { error: "Non permissible resource" });
        const b = await body(req);
        acc.users.push(Number(b.user_id));
        return json(res, 200, { account_id: acc.id, user_id: b.user_id, role: b.role });
      }
      return json(res, 404, { error: "not found" });
    }

    // ---------- Application API ----------
    const am = p.match(/^\/api\/v1\/accounts\/(\d+)\/(.*)$/);
    if (am) {
      const acc = accounts.get(Number(am[1]));
      const u = userByToken(token);
      if (!u || !acc || !acc.users.includes(u.id)) return json(res, 401, { error: "You are not authorized to access this account" });
      const rest = am[2];
      if (rest === "webhooks" && req.method === "POST") {
        const b = (await body(req)).webhook as { url: string; subscriptions: string[] };
        const wh = { id: nextId(), url: b.url, secret: randomBytes(16).toString("hex"), subscriptions: b.subscriptions };
        acc.webhooks.push(wh);
        return json(res, 200, { payload: { webhook: { ...wh, account_id: acc.id, name: "Loopchat" } } });
      }
      if (rest === "webhooks" && req.method === "GET") return json(res, 200, { payload: { webhooks: acc.webhooks } });
      if (rest === "inboxes" && req.method === "POST") {
        const b = await body(req);
        const ch = b.channel as { phone_number: string; provider_config: Record<string, unknown> };
        if (String(ch.provider_config?.api_key ?? "").startsWith("invalid")) return json(res, 422, { message: "Invalid WhatsApp Cloud API credentials" });
        const inbox = { id: nextId(), name: String(b.name), phone_number: ch.phone_number, provider_config: { ...ch.provider_config, webhook_verify_token: randomBytes(8).toString("hex") } };
        acc.inboxes.push(inbox);
        return json(res, 200, { id: inbox.id, name: inbox.name, channel_type: "Channel::Whatsapp" });
      }
      if (/^inboxes\/\d+\/sync_templates$/.test(rest) && req.method === "POST") return json(res, 200, {});
      const im = rest.match(/^inboxes\/(\d+)$/);
      if (im) {
        const inbox = acc.inboxes.find((i) => i.id === Number(im[1]));
        if (!inbox) return json(res, 404, { error: "Resource could not be found" });
        if (req.method === "GET") return json(res, 200, { id: inbox.id, name: inbox.name, channel_type: "Channel::Whatsapp", phone_number: inbox.phone_number, provider_config: { webhook_verify_token: inbox.provider_config.webhook_verify_token }, message_templates: SIM_TEMPLATES });
        if (req.method === "PATCH") {
          const b = await body(req);
          const pc = (b.channel as { provider_config?: Record<string, unknown> })?.provider_config;
          if (pc) inbox.provider_config = { ...inbox.provider_config, ...pc };
          return json(res, 200, { id: inbox.id });
        }
        if (req.method === "DELETE") {
          acc.inboxes = acc.inboxes.filter((i) => i.id !== inbox.id);
          return json(res, 200, {});
        }
      }
      if (rest.startsWith("conversations") && req.method === "GET" && /^conversations(\?.*)?$/.test(rest)) {
        const list = [...acc.conversations].sort((a, b) => (b.messages.at(-1)?.created_at ?? 0) - (a.messages.at(-1)?.created_at ?? 0));
        const page = Number(url.searchParams.get("page") ?? 1);
        return json(res, 200, { data: { meta: { all_count: list.length }, payload: list.slice((page - 1) * 25, page * 25).map((c) => convPushData(acc, c)) } });
      }
      const cm = rest.match(/^conversations\/(\d+)(\/.*)?$/);
      if (cm) {
        const conv = acc.conversations.find((c) => c.id === Number(cm[1]));
        if (!conv) return json(res, 404, { error: "Resource could not be found" });
        const sub = cm[2] ?? "";
        if (sub === "" && req.method === "GET") return json(res, 200, convPushData(acc, conv));
        if (sub === "/messages" && req.method === "GET") {
          const before = Number(url.searchParams.get("before") ?? 0);
          const list = conv.messages.filter((m) => !before || m.id < before).slice(-20);
          return json(res, 200, { meta: { contact: contactRef(acc, conv.contact_id) }, payload: list.map((m) => apiMsg(conv, m)) });
        }
        if (sub === "/messages" && req.method === "POST") {
          const b = await body(req);
          if (failNextSend) {
            failNextSend = false;
            return json(res, 500, { error: "Simulated failure" });
          }
          const outsideWindow = conv.last_incoming_at === null || Date.now() / 1000 - conv.last_incoming_at > 86400;
          const m: Msg = {
            id: nextId(),
            content: (b.content as string) ?? null,
            message_type: b.template_params ? 3 : 1,
            created_at: Math.floor(Date.now() / 1000),
            private: Boolean(b.private),
            status: (outsideWindow && !b.template_params) || (b.template_params && !approvedTemplate(b.template_params as Record<string, unknown>)) ? "failed" : "sent",
            content_attributes: {
              ...((b.content_attributes as Record<string, unknown>) ?? {}),
              ...(outsideWindow && !b.template_params ? { external_error: "Message outside messaging window" } : {}),
              ...(b.template_params && !approvedTemplate(b.template_params as Record<string, unknown>) ? { external_error: "(#132001) Template name does not exist in the translation" } : {}),
            },
            source_id: null,
            sender: { id: 1, name: "Loopchat (servicio)", type: "user" },
            attachments: Array.isArray(b.attachments) && b.attachments.length ? (b.attachments as { file_type: string; file_size: number }[]).map((a) => ({ id: nextId(), file_type: a.file_type, data_url: "https://example.invalid/adjunto", thumb_url: null, file_size: a.file_size })) : undefined,
          };
          conv.messages.push(m);
          setTimeout(() => void emit(acc, webhookMsg(acc, conv, m, "message_created")), 30);
          return json(res, 200, apiMsg(conv, m));
        }
        if (sub === "/toggle_status" && req.method === "POST") {
          const b = await body(req);
          conv.status = b.status as Conv["status"];
          setTimeout(() => void emit(acc, { event: "conversation_status_changed", ...convPushData(acc, conv), changed_attributes: [{ status: { current_value: conv.status } }] }), 10);
          return json(res, 200, { payload: { success: true, current_status: conv.status, conversation_id: conv.id } });
        }
      }
      return json(res, 404, { error: "not found" });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => console.log(`[chatwoot-sim] SIMULADOR de contrato escuchando en http://localhost:${PORT} (no es Chatwoot real)`));
