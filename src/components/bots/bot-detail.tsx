"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Power, RotateCcw, Rocket } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { FlowGraph } from "@/lib/flow/types";
import { BotSettings, type BotRow } from "./bot-settings";
import type { StageOpt } from "./settings/shared";
import { BotSimulator } from "./simulator";
import { METRIC_LABELS } from "@/lib/instructions/catalog";

const FlowEditor = dynamic(() => import("./flow-editor").then((m) => m.FlowEditor), { ssr: false, loading: () => <SkeletonRows rows={4} /> });

type Detail = { bot: BotRow & { draftGraph: FlowGraph | null; draftRevision: number }; versions: { id: string; version: number; publishedAt: string; checksum: string; hasSettings: boolean }[]; unpublishedChanges: boolean };
type RunMetrics = { aiCalls?: number; inputTokens?: number; outputTokens?: number; latencyMs?: number; tools?: string[]; blocked?: string[]; products?: string[]; handoffCode?: string; handoffReason?: string; insultTerms?: string[]; team?: { intent: string | null; hops: { toHuman: boolean; reason: string }[]; aiUsed: boolean }; instructions?: { version: string; hash: string } };
type Run = { id: string; status: string; conversationId: string; version: number; stepCount: number; lastError: string | null; startedAt: string; finishedAt: string | null; metrics: RunMetrics; steps: { nodeType: string; summary: string | null }[] };

const HANDOFF_LABEL: Record<string, string> = { insult_detection: "Insulto detectado (sin IA)", keyword: "Palabra clave", ai: "La IA pidió una persona", max_attempts: "Consultas sin resolver", out_of_hours: "Fuera de horario", flow: "Paso del flujo", error: "Falla del bot", quota: "Cupo de IA agotado", no_ai: "Sin proveedor de IA", team_route: "Derivación del equipo", high_value: "Oportunidad de alto valor", tool_error: "Error en una acción", usage_limit: "Límite de uso de IA" };
const TOOL_NAME: Record<string, string> = { classify: "clasificar", use_knowledge: "conocimiento", use_catalog: "catálogo", create_opportunity: "oportunidad", update_stage: "mover etapa", create_task: "tarea", handoff: "pedir humano", collect_data: "datos comerciales", send_photo: "foto" };

type TabId = "flow" | "settings" | "test" | "runs" | "versions";

const RUN_LABEL: Record<string, string> = { queued: "En cola", running: "Ejecutando", waiting: "Esperando respuesta", completed: "Completada", failed: "Con error", cancelled: "Cancelada", handed_off: "Derivada a humano" };

export function BotDetail({ id, stages, companyHours }: { id: string; stages: StageOpt[]; companyHours: { enabled: boolean; summary: string; message: string } | null }) {
  const d = useApi<Detail>(`/api/v1/bots/${id}`);
  const conns = useApi<{ id: string; label: string; provider: string; defaultModel: string; status: string }[]>("/api/v1/ai-connections");
  const channels = useApi<{ id: string; displayName: string; phoneNumber: string; status: string }[]>("/api/v1/channels");
  const canEdit = useCan("bot:write");
  const canPublish = useCan("bot:publish");
  const toast = useToast();
  const [tab, setTab] = useState<TabId | null>(null);
  const runs = useApi<Run[]>(tab === "runs" ? `/api/v1/bots/${id}/runs` : null);
  const [busy, setBusy] = useState(false);
  const graphRef = useRef<() => unknown>(() => undefined);

  if (d.loading) return <SkeletonRows />;
  if (d.error || !d.data) return <ErrorState description={d.error?.message ?? "Bot no encontrado."} />;
  const bot = d.data.bot;
  const tabs: { id: TabId; label: string }[] = [...(bot.mode === "flow" ? [{ id: "flow" as const, label: "Flujo" }] : []), { id: "settings", label: "Configuración" }, { id: "test", label: "Probar" }, { id: "runs", label: "Ejecuciones" }, { id: "versions", label: "Versiones" }];
  const currentTab: TabId = tab ?? (bot.mode === "flow" ? "flow" : "settings");

  async function publish() {
    setBusy(true);
    try {
      const r = await api<{ version: number }>(`/api/v1/bots/${id}/publish`, { body: {} });
      toast.push("success", `Versión ${r.version} publicada.`);
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(versionId: string, version: number) {
    if (!window.confirm(`¿Recuperar la configuración de la v${version} como borrador? No cambia lo publicado hasta que publiques.`)) return;
    setBusy(true);
    try {
      const r = await api<{ settingsRestored: boolean }>(`/api/v1/bots/${id}/versions/${versionId}/restore`, { body: {} });
      toast.push("success", r.settingsRestored ? `Borrador restaurado desde la v${version}. Publicá para aplicarlo.` : `Se restauró el flujo de la v${version} (esa versión no guardaba configuración extendida).`);
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setBusy(true);
    try {
      await api(`/api/v1/bots/${id}/status`, { body: { status: bot.status === "active" ? "inactive" : "active" } });
      toast.push("success", bot.status === "active" ? "Bot desactivado." : "Bot activo: responde los mensajes nuevos.");
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <Link href="/chatbots" className="mb-3 inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Chatbots
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{bot.name}</h1>
        <Badge tone={bot.status === "active" ? "success" : "neutral"}>{bot.status === "active" ? "Activo" : "Inactivo"}</Badge>
        <Badge>{bot.mode === "flow" ? "Flujo visual" : "Por instrucciones"}</Badge>
        <span className="text-[12.5px] text-fg-muted">{d.data.versions[0] ? `Versión publicada: v${d.data.versions.find((v) => v.id === bot.publishedVersionId)?.version ?? "—"}` : "Sin versiones publicadas"}</span>
        {canPublish ? (
          <span className="ml-auto flex gap-2">
            {bot.mode === "instructions" ? (
              <Button variant="primary" onClick={publish} loading={busy}>
                <Rocket className="size-4" aria-hidden /> Publicar versión
              </Button>
            ) : null}
            <Button onClick={toggle} loading={busy} disabled={!bot.publishedVersionId && bot.status !== "active"}>
              <Power className="size-4" aria-hidden /> {bot.status === "active" ? "Desactivar" : "Activar"}
            </Button>
          </span>
        ) : null}
      </div>
      {d.data.unpublishedChanges ? (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Hay cambios guardados sin publicar. El bot en uso sigue con la versión publicada.</span>
          {canPublish ? (
            <Button size="sm" variant="primary" onClick={publish} loading={busy}>
              <Rocket className="size-3.5" aria-hidden /> Publicar ahora
            </Button>
          ) : null}
        </div>
      ) : null}
      <div role="tablist" aria-label="Secciones del bot" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={currentTab === t.id} onClick={() => setTab(t.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap", currentTab === t.id ? "border-brand-strong text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
            {t.label}
          </button>
        ))}
      </div>
      {bot.mode === "flow" && bot.draftGraph ? (
        // se mantiene montado al cambiar de pestaña para no perder cambios sin guardar
        <div hidden={currentTab !== "flow"}>
          <FlowEditor botId={id} initialGraph={bot.draftGraph} initialRevision={bot.draftRevision} stages={stages} canEdit={canEdit} canPublish={canPublish} onPublished={() => void d.reload()} graphRef={graphRef} />
        </div>
      ) : null}
      {currentTab === "settings" ? <BotSettings bot={bot} connections={conns.data ?? []} channels={(channels.data ?? []).filter((c) => c.status !== "disconnected")} canEdit={canEdit} onSaved={() => void d.reload()} stages={stages} companyHours={companyHours} /> : null}
      {currentTab === "test" ? <BotSimulator botId={id} getGraph={bot.mode === "flow" ? () => graphRef.current() : undefined} versions={d.data.versions} /> : null}
      {currentTab === "runs" && runs.data?.length ? <Indicators runs={runs.data} metrics={bot.config.identity.metrics} /> : null}
      {currentTab === "runs" ? (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {runs.loading ? <SkeletonRows /> : null}
          {runs.data?.length === 0 ? <EmptyState title="Sin ejecuciones todavía" description="Cuando el bot atienda mensajes reales, cada ejecución aparece acá con sus pasos." /> : null}
          <ul className="divide-y divide-border">
            {runs.data?.map((r) => (
              <li key={r.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : r.status === "handed_off" ? "warning" : "neutral"}>{RUN_LABEL[r.status] ?? r.status}</Badge>
                  <span className="text-fg-muted">v{r.version} · {formatDateTime(r.startedAt)} · {r.stepCount} pasos</span>
                  <Link href={`/conversaciones?c=${r.conversationId}`} className="ml-auto text-[12.5px] underline underline-offset-2">
                    Ver conversación
                  </Link>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                  <Badge tone={r.metrics.aiCalls ? "info" : "neutral"}>{r.metrics.aiCalls ? `IA: ${r.metrics.aiCalls} llamada${r.metrics.aiCalls === 1 ? "" : "s"} · ${(r.metrics.inputTokens ?? 0) + (r.metrics.outputTokens ?? 0)} tokens · ${r.metrics.latencyMs ?? 0} ms` : "Sin llamar a la IA"}</Badge>
                  {r.metrics.tools?.length ? <Badge>Herramientas: {r.metrics.tools.map((t) => TOOL_NAME[t] ?? t).join(", ")}</Badge> : null}
                  {r.metrics.handoffCode ? <Badge tone="warning">Derivación: {HANDOFF_LABEL[r.metrics.handoffCode] ?? r.metrics.handoffCode}</Badge> : null}
                  {r.metrics.blocked?.length ? <Badge tone="danger">{r.metrics.blocked.length} acción(es) bloqueada(s)</Badge> : null}
                  {r.metrics.team?.hops.length ? <Badge tone="info">Equipo: {r.metrics.team.hops.map((h) => h.reason).join(" → ")}</Badge> : null}
                  {r.finishedAt ? <span className="text-fg-muted">Duración: {Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 100) / 10)} s</span> : null}
                </div>
                {r.metrics.blocked?.length ? <p className="mt-1 text-[12px] text-danger">Bloqueadas: {r.metrics.blocked.join(" · ")}</p> : null}
                {r.metrics.products?.length ? <p className="mt-1 text-[12px] text-fg-muted">Productos consultados: {r.metrics.products.join(", ")}</p> : null}
                {r.metrics.instructions ? <p className="mt-1 text-[11.5px] text-fg-muted">Instrucciones ejecutadas: motor {r.metrics.instructions.version} · huella {r.metrics.instructions.hash}</p> : null}
                {r.lastError ? <p className="mt-1 text-[12.5px] text-fg-secondary">{r.lastError}</p> : null}
                <p className="mt-1 text-[12px] text-fg-muted">{r.steps.map((s) => s.summary).join(" → ")}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {currentTab === "versions" ? <VersionCompare botId={id} versions={d.data.versions} /> : null}
      {currentTab === "versions" ? (
        <div className="mt-3 overflow-hidden rounded-[10px] border border-border bg-surface">
          {d.data.versions.length === 0 ? <EmptyState title="Sin versiones publicadas" description="Las versiones publicadas son inmutables: guardar cambios no modifica lo que ejecuta el bot hasta publicar." /> : null}
          <ul className="divide-y divide-border">
            {d.data.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-medium">v{v.version}</span>
                <span className="text-fg-muted">{formatDateTime(v.publishedAt)}</span>
                <code className="text-[11.5px] text-fg-muted">{v.checksum}</code>
                {v.id === bot.publishedVersionId ? <Badge tone="brand">En uso</Badge> : null}
                {!v.hasSettings ? <span className="text-[11.5px] text-fg-muted">(sin copia de configuración)</span> : null}
                {canEdit && v.id !== bot.publishedVersionId ? (
                  <Button size="sm" variant="ghost" className="ml-auto" loading={busy} onClick={() => restore(v.id, v.version)}>
                    <RotateCcw className="size-3.5" aria-hidden /> Recuperar como borrador
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Change = { path: string; label: string; before: unknown; after: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "—") : typeof v === "boolean" ? (v ? "sí" : "no") : String(v));

/** Comparar dos versiones (o una versión con el borrador): qué cambió, en lenguaje claro. */
function VersionCompare({ botId, versions }: { botId: string; versions: { id: string; version: number }[] }) {
  const [a, setA] = useState(versions[0]?.id ?? "draft");
  const [b, setB] = useState("draft");
  const [res, setRes] = useState<{ a: string; b: string; changes: Change[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opts = [{ id: "draft", label: "Borrador" }, ...versions.map((v) => ({ id: v.id, label: `v${v.version}` }))];
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4 text-[13px]">
      <p className="mb-2 font-semibold">Comparar versiones</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Versión A" value={a} onChange={(e) => setA(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-1.5">
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-fg-muted">con</span>
        <select aria-label="Versión B" value={b} onChange={(e) => setB(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-1.5">
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={async () => {
            setErr(null);
            try {
              setRes(await api(`/api/v1/bots/${botId}/versions/compare?a=${a}&b=${b}`));
            } catch (e) {
              setErr((e as ApiError).message);
            }
          }}
        >
          Ver qué cambió
        </Button>
      </div>
      {err ? <p className="mt-2 text-danger">{err}</p> : null}
      {res ? (
        res.changes.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <caption className="sr-only">Cambios entre {res.a} y {res.b}</caption>
              <thead className="text-fg-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Qué</th>
                  <th className="py-1 pr-3 font-medium">{res.a}</th>
                  <th className="py-1 font-medium">{res.b}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {res.changes.map((c) => (
                  <tr key={c.path} className="align-top">
                    <td className="py-1 pr-3 font-medium">{c.label}</td>
                    <td className="max-w-[260px] break-words py-1 pr-3 text-fg-secondary">{show(c.before).slice(0, 300)}</td>
                    <td className="max-w-[260px] break-words py-1">{show(c.after).slice(0, 300)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-fg-muted">No hay diferencias entre {res.a} y {res.b}.</p>
        )
      ) : null}
    </div>
  );
}

/** Indicadores elegidos en "Objetivos", calculados con ejecuciones reales (no se inventan resultados). */
function Indicators({ runs, metrics }: { runs: Run[]; metrics: string[] }) {
  const keys = metrics.length ? metrics : ["handled", "resolved", "handoffs", "ai_usage"];
  const done = runs.filter((r) => r.finishedAt);
  const value: Record<string, string> = {
    handled: String(runs.length),
    resolved: String(runs.filter((r) => r.status === "completed").length),
    opportunities: String(runs.filter((r) => r.metrics.tools?.includes("create_opportunity")).length),
    qualified: String(runs.filter((r) => r.metrics.tools?.includes("update_stage")).length),
    transfers: String(runs.reduce((n, r) => n + (r.metrics.team?.hops.filter((h) => !h.toHuman).length ?? 0), 0)),
    handoffs: String(runs.filter((r) => r.status === "handed_off").length),
    resolution_time: done.length ? `${Math.round(done.reduce((n, r) => n + (new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime()), 0) / done.length / 100) / 10} s` : "—",
    verified_actions: String(runs.reduce((n, r) => n + (r.metrics.tools?.filter((t) => ["create_opportunity", "update_stage", "create_task", "collect_data"].includes(t)).length ?? 0), 0)),
    ai_usage: `${runs.reduce((n, r) => n + (r.metrics.aiCalls ?? 0), 0)} llamadas · ${runs.reduce((n, r) => n + (r.metrics.inputTokens ?? 0) + (r.metrics.outputTokens ?? 0), 0)} tokens`,
  };
  return (
    <section aria-label="Indicadores" className="mb-3">
      <p className="mb-1.5 text-[12px] text-fg-muted">Indicadores de las últimas {runs.length} ejecuciones (se eligen en Configuración → Objetivos).</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keys.map((k) => (
          <div key={k} className="rounded-[10px] border border-border bg-surface px-3 py-2">
            <dt className="text-[12px] text-fg-muted">{METRIC_LABELS[k] ?? k}</dt>
            <dd className="text-[15px] font-semibold tabular">{value[k] ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
