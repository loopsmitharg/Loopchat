import "server-only";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { opsAlerts, opsHeartbeats } from "../db/schema";
import { log } from "../log";
import { sendMail } from "../mail";

/**
 * Monitor operativo (correr cada minuto: `npm run monitor`). Cada chequeo devuelve alertas con clave
 * estable; se notifican al abrirse, se recuerdan cada `ALERT_REPEAT_HOURS` y se avisa al resolverse.
 * Canales: ALERT_WEBHOOK_URL (POST JSON compatible con Slack/Discord/Google Chat) y/o ALERT_EMAIL.
 * Ningún mensaje incluye secretos, contenidos de conversaciones ni datos personales.
 */
export type Finding = { key: string; severity: "warning" | "critical"; summary: string };
export type Metrics = Record<string, number | string | null>;

const num = (name: string, d: number) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : d);

async function probe(url: string, timeoutMs = 5000) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function collect(): Promise<{ findings: Finding[]; metrics: Metrics }> {
  const findings: Finding[] = [];
  const metrics: Metrics = {};
  const add = (key: string, severity: Finding["severity"], summary: string) => findings.push({ key, severity, summary });

  // 1) disponibilidad y latencia
  const appUrl = process.env.MONITOR_APP_URL ?? process.env.APP_URL;
  if (appUrl) {
    const p = await probe(new URL("/api/health", appUrl).toString());
    metrics.app_status = p.status;
    metrics.app_ms = p.ms;
    if (!p.ok || p.status !== 200) add("app_down", "critical", `Loopchat no responde correctamente (HTTP ${p.status || "sin respuesta"}).`);
    else if (p.ms > num("ALERT_SLOW_MS", 3000)) add("app_slow", "warning", `Loopchat responde lento: ${p.ms} ms en /api/health.`);
  }
  const cw = process.env.CHATWOOT_BASE_URL;
  if (cw) {
    const p = await probe(new URL("/api", cw).toString());
    metrics.chatwoot_status = p.status;
    metrics.chatwoot_ms = p.ms;
    if (!p.ok) add("chatwoot_down", "critical", `Chatwoot no responde (HTTP ${p.status || "sin respuesta"}): no entran ni salen mensajes de WhatsApp.`);
  }

  // 2) cola, trabajos y errores (base de datos de Loopchat)
  const q = (
    await db.execute<{ queued: number; oldest: number | null; failed15: number; expired: number; wh_failed: number; out_failed: number; ai_failed: number; ai_total: number; http5xx: number }>(sql`
    select
      (select count(*) from jobs where status = 'queued' and run_at <= now())::int as queued,
      (select extract(epoch from now() - min(run_at))::int from jobs where status = 'queued' and run_at <= now()) as oldest,
      (select count(*) from jobs where status = 'failed' and updated_at > now() - interval '15 minutes')::int as failed15,
      (select count(*) from jobs where status = 'running' and locked_until < now() - interval '5 minutes')::int as expired,
      (select count(*) from webhook_events where status = 'failed' and received_at > now() - interval '15 minutes')::int as wh_failed,
      (select count(*) from messages where status = 'failed' and direction = 'out' and updated_at > now() - interval '15 minutes')::int as out_failed,
      (select count(*) from usage_events where metric = 'ai_calls' and outcome = 'failure' and created_at > now() - interval '15 minutes')::int as ai_failed,
      (select count(*) from usage_events where metric = 'ai_calls' and created_at > now() - interval '15 minutes')::int as ai_total,
      (select coalesce(sum(count), 0) from rate_limits where key = 'ops:http5xx' and window_start > extract(epoch from now())::bigint - 300)::int as http5xx`)
  ).rows[0];
  Object.assign(metrics, { queue_pending: q.queued, queue_oldest_s: q.oldest ?? 0, jobs_failed_15m: q.failed15, jobs_lease_expired: q.expired, webhooks_failed_15m: q.wh_failed, outbound_failed_15m: q.out_failed, ai_failed_15m: q.ai_failed, ai_calls_15m: q.ai_total, http_5xx_5m: q.http5xx });
  if ((q.oldest ?? 0) > num("ALERT_QUEUE_AGE_S", 120)) add("queue_lag", (q.oldest ?? 0) > 600 ? "critical" : "warning", `La cola está atrasada: ${q.queued} trabajo(s) pendiente(s), el más viejo hace ${q.oldest} s. ¿Está corriendo el worker?`);
  if (q.failed15 >= num("ALERT_JOBS_FAILED", 5)) add("jobs_failed", "warning", `${q.failed15} trabajo(s) fallaron definitivamente en 15 min.`);
  if (q.expired > 0) add("jobs_abandoned", "warning", `${q.expired} trabajo(s) con lease vencido hace más de 5 min (worker caído o colgado).`);
  if (q.wh_failed >= num("ALERT_WEBHOOKS_FAILED", 3)) add("webhooks_failed", "warning", `${q.wh_failed} evento(s) de Chatwoot fallaron en 15 min.`);
  if (q.out_failed >= num("ALERT_OUTBOUND_FAILED", 5)) add("outbound_failed", "warning", `${q.out_failed} mensaje(s) salientes fallaron en 15 min (Chatwoot/Meta).`);
  if (q.ai_total >= 5 && q.ai_failed / q.ai_total >= 0.5) add("ai_failures", "warning", `${q.ai_failed} de ${q.ai_total} llamadas a IA fallaron en 15 min (proveedor o credenciales de algún cliente).`);
  if (q.http5xx >= num("ALERT_HTTP_5XX", 10)) add("http_5xx", "critical", `${q.http5xx} errores HTTP 5xx en 5 min.`);

  // 3) recursos del host
  const load = os.loadavg()[0] / os.cpus().length;
  const memFree = os.freemem() / os.totalmem();
  metrics.cpu_load_per_core = Number(load.toFixed(2));
  metrics.mem_free_pct = Math.round(memFree * 100);
  if (load > num("ALERT_LOAD_PER_CORE", 1.5)) add("cpu_high", "warning", `Carga de CPU alta: ${load.toFixed(2)} por núcleo.`);
  if (memFree < num("ALERT_MEM_FREE_PCT", 10) / 100) add("mem_low", "warning", `Memoria libre baja: ${Math.round(memFree * 100)} %.`);
  for (const dir of [process.env.STORAGE_DIR ?? "./storage", ...(process.env.MONITOR_DISK_PATHS ?? "").split(",").filter(Boolean)]) {
    try {
      const s = await statfs(dir);
      const used = 1 - s.bavail / s.blocks;
      metrics[`disk_used_pct:${dir}`] = Math.round(used * 100);
      if (used > num("ALERT_DISK_USED_PCT", 85) / 100) add(`disk:${dir}`, used > 0.95 ? "critical" : "warning", `Disco casi lleno en ${dir}: ${Math.round(used * 100)} % usado.`);
    } catch {
      /* ruta inexistente en este host */
    }
  }

  // 4) backups y prueba de restore (registrados por los scripts con `npm run ops:heartbeat`)
  const beats = await db.select().from(opsHeartbeats);
  for (const [name, maxH] of [["backup", num("BACKUP_MAX_AGE_HOURS", 26)], ["restore_test", num("RESTORE_TEST_MAX_AGE_HOURS", 24 * 8)]] as const) {
    const b = beats.find((x) => x.name === name);
    const ageH = b?.lastOkAt ? (Date.now() - b.lastOkAt.getTime()) / 3600_000 : Infinity;
    metrics[`${name}_age_h`] = Number.isFinite(ageH) ? Math.round(ageH) : null;
    if (b?.lastStatus === "fail") add(`${name}_failed`, "critical", `Falló ${name === "backup" ? "el backup" : "la prueba de restore"}: ${b.detail ?? "ver logs"}.`);
    else if (ageH > maxH) add(`${name}_missing`, "critical", `${name === "backup" ? "No hay backup verificado" : "No hay prueba de restore"} en las últimas ${maxH} h.`);
  }

  // 5) consumo de IA por empresa (cupo mensual del plan; el gasto lo paga cada cliente con su clave)
  const usage = await db.execute<{ slug: string; used: number; lim: number }>(sql`
    select t.slug, c.value as used, coalesce((s.limit_overrides->>'aiCallsPerMonth')::int, (p.limits->>'aiCallsPerMonth')::int) as lim
    from usage_counters c join tenants t on t.id = c.tenant_id join subscriptions s on s.tenant_id = t.id join plans p on p.id = s.plan_id
    where c.metric = 'ai_calls' and c.period = to_char(now() at time zone 'utc', 'YYYY-MM')`);
  for (const u of usage.rows) {
    if (!u.lim) continue;
    const pct = u.used / u.lim;
    if (pct >= 1) add(`ai_quota:${u.slug}`, "warning", `La empresa ${u.slug} agotó su cupo mensual de IA (${u.used}/${u.lim}): sus bots derivan a personas.`);
    else if (pct >= 0.8) add(`ai_quota:${u.slug}`, "warning", `La empresa ${u.slug} usó el ${Math.round(pct * 100)} % de su cupo mensual de IA (${u.used}/${u.lim}).`);
  }
  return { findings, metrics };
}

type Notification = { title: string; lines: string[] };

export async function notify(n: Notification) {
  const text = `${n.title}\n${n.lines.map((l) => `• ${l}`).join("\n")}`;
  const sent: string[] = [];
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }) });
    if (!r.ok) throw new Error(`webhook de alertas respondió ${r.status}`);
    sent.push("webhook");
  }
  const to = process.env.ALERT_EMAIL;
  if (to) {
    await sendMail({ to, subject: n.title, text });
    sent.push("email");
  }
  if (!sent.length) log.warn("ops.alert_no_channel", { title: n.title });
  return sent;
}

/** Aplica el ciclo de vida de las alertas y notifica los cambios. Devuelve lo notificado. */
export async function evaluateAndNotify(findings: Finding[], host = os.hostname()) {
  const repeatMs = num("ALERT_REPEAT_HOURS", 6) * 3600_000;
  const open = await db.select().from(opsAlerts).where(eq(opsAlerts.status, "firing"));
  const now = new Date();
  const fire: Finding[] = [];
  for (const f of findings) {
    const prev = open.find((a) => a.key === f.key);
    if (!prev) {
      await db
        .insert(opsAlerts)
        .values({ key: f.key, severity: f.severity, status: "firing", summary: f.summary, firstAt: now, lastNotifiedAt: now })
        .onConflictDoUpdate({ target: opsAlerts.key, set: { severity: f.severity, status: "firing", summary: f.summary, firstAt: now, lastNotifiedAt: now, resolvedAt: null } });
      fire.push(f);
    } else if (!prev.lastNotifiedAt || now.getTime() - prev.lastNotifiedAt.getTime() >= repeatMs) {
      await db.update(opsAlerts).set({ summary: f.summary, lastNotifiedAt: now }).where(eq(opsAlerts.key, f.key));
      fire.push(f);
    }
  }
  const resolved = open.filter((a) => !findings.some((f) => f.key === a.key));
  for (const a of resolved) await db.update(opsAlerts).set({ status: "resolved", resolvedAt: now }).where(eq(opsAlerts.key, a.key));
  const notes: Notification[] = [];
  if (fire.length) notes.push({ title: `[Loopchat ${fire.some((f) => f.severity === "critical") ? "CRÍTICO" : "aviso"}] ${host}`, lines: fire.map((f) => f.summary) });
  if (resolved.length) notes.push({ title: `[Loopchat resuelto] ${host}`, lines: resolved.map((a) => a.summary) });
  for (const n of notes) await notify(n);
  return { fired: fire.map((f) => f.key), resolved: resolved.map((a) => a.key) };
}

export async function recordHeartbeat(name: string, status: "ok" | "fail", detail: string | null) {
  await db
    .insert(opsHeartbeats)
    .values({ name, lastStatus: status, lastRunAt: new Date(), lastOkAt: status === "ok" ? new Date() : null, detail })
    .onConflictDoUpdate({ target: opsHeartbeats.name, set: { lastStatus: status, lastRunAt: new Date(), detail, ...(status === "ok" ? { lastOkAt: new Date() } : {}) } });
}
