"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Hand, Power, Rocket, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { INTENT_LABELS, type TeamGraph, type TeamIntent } from "@/lib/team/types";
import type { TeamIssue } from "@/lib/team/validate";
import type { PipelineOpt, TeamBotOpt, TeamEditorApi } from "./team-editor";
import { TeamSettingsPanel } from "./team-settings";
import { TeamSimulator } from "./team-simulator";

const TeamEditor = dynamic(() => import("./team-editor").then((m) => m.TeamEditor), { ssr: false, loading: () => <SkeletonRows rows={4} /> });

type Detail = {
  team: { id: string; name: string; description: string; status: string; channelConnectionId: string | null; publishedVersionId: string | null; draftGraph: TeamGraph; draftRevision: number };
  versions: { id: string; version: number; publishedAt: string; checksum: string }[];
  published: { id: string; version: number } | null;
  issues: TeamIssue[];
  unpublishedChanges: boolean;
};
type Transfer = { id: string; conversationId: string; fromBotId: string | null; toBotId: string | null; toHuman: boolean; kind: string; intent: TeamIntent | null; reason: string; version: number | null; createdAt: string };

const KIND_LABEL: Record<string, string> = { entry: "Inicio", keyword: "Palabra clave", intent: "Necesidad", ai: "IA", unknown: "Sin identificar", unavailable: "No disponible", loop_guard: "Protección de bucles", automation: "Automatización", manual: "Manual" };
type TabId = "team" | "settings" | "test" | "runs" | "versions";

export function TeamDetail({ id }: { id: string }) {
  const d = useApi<Detail>(`/api/v1/teams/${id}`);
  const bots = useApi<TeamBotOpt[]>("/api/v1/bots");
  const pipes = useApi<(PipelineOpt & { stages: { id: string; name: string; kind: string }[] })[]>("/api/v1/pipelines");
  const canEdit = useCan("bot:write");
  const canPublish = useCan("bot:publish");
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("team");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<TeamIssue[] | null>(null);
  const transfers = useApi<Transfer[]>(tab === "runs" ? `/api/v1/teams/${id}/transfers` : null);
  const graphRef = useRef<() => TeamGraph>(() => d.data!.team.draftGraph);
  const editorApi = useRef<TeamEditorApi | null>(null);
  const onSaved = useCallback((i: TeamIssue[]) => setIssues(i), []);

  if (d.loading || bots.loading || pipes.loading) return <SkeletonRows />;
  if (d.error || !d.data) return <ErrorState description={d.error?.message ?? "Equipo no encontrado."} />;
  const team = d.data.team;
  const currentIssues = issues ?? d.data.issues;
  const errors = currentIssues.filter((i) => i.severity === "error");
  const botName = (botId: string | null) => (botId ? (bots.data?.find((b) => b.id === botId)?.name ?? "Bot eliminado") : "—");

  async function call(path: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      // antes de publicar se guarda el borrador pendiente del editor
      await editorApi.current?.flush();
      await api(path, { body });
      toast.push("success", ok);
      setIssues(null);
      void d.reload();
    } catch (e) {
      const err = e as ApiError;
      const list = (err.details?.issues as TeamIssue[] | undefined)?.map((i) => i.message).join(" · ");
      toast.push("error", list ? `${err.message} ${list}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "team", label: "Equipo" },
    { id: "settings", label: "Configuración" },
    { id: "test", label: "Probar" },
    { id: "runs", label: "Derivaciones" },
    { id: "versions", label: "Versiones" },
  ];

  return (
    <div className="p-4 sm:p-6">
      <Link href="/chatbots?tab=equipos" className="mb-3 inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Equipos de chatbots
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{team.name}</h1>
        <Badge tone={team.status === "active" ? "success" : "neutral"}>{team.status === "active" ? "Activo" : "Inactivo"}</Badge>
        <span className="text-[12.5px] text-fg-muted">{d.data.published ? `Versión publicada: v${d.data.published.version}` : "Sin versiones publicadas"}</span>
        {canPublish ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => call(`/api/v1/teams/${id}/publish`, {}, "Equipo publicado. Las conversaciones nuevas usan esta versión; las que están en curso siguen con la suya hasta resolverse.")} loading={busy} disabled={errors.length > 0}>
              <Rocket className="size-4" aria-hidden /> Publicar versión
            </Button>
            <Button onClick={() => call(`/api/v1/teams/${id}/status`, { status: team.status === "active" ? "inactive" : "active" }, team.status === "active" ? "Equipo desactivado." : "Equipo activo: atiende los mensajes nuevos.")} loading={busy} disabled={!team.publishedVersionId && team.status !== "active"}>
              <Power className="size-4" aria-hidden /> {team.status === "active" ? "Desactivar" : "Activar"}
            </Button>
            {team.status !== "active" ? (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm("¿Eliminar este equipo? Los bots no se borran; las conversaciones que lo usaban vuelven a la atención normal.")) return;
                  try {
                    await api(`/api/v1/teams/${id}`, { method: "DELETE" });
                    router.push("/chatbots?tab=equipos");
                  } catch (e) {
                    toast.push("error", (e as ApiError).message);
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden /> Eliminar
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {d.data.unpublishedChanges && d.data.published ? (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#fedf89] bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Hay cambios sin publicar. El equipo en uso sigue con la v{d.data.published.version}.</span>
        </div>
      ) : null}
      {errors.length && canPublish ? <p className="mb-3 text-[12.5px] text-danger">Corregí los problemas marcados en la pestaña Equipo para poder publicar.</p> : null}

      <div role="tablist" aria-label="Secciones del equipo" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap", tab === t.id ? "border-brand-strong text-fg" : "border-transparent text-fg-secondary hover:text-fg")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* el editor queda montado: la configuración y el simulador usan el borrador en memoria */}
      <div hidden={tab !== "team"}>
        <TeamEditor
          teamId={id}
          initialGraph={team.draftGraph}
          initialRevision={team.draftRevision}
          initialIssues={d.data.issues}
          bots={bots.data ?? []}
          pipelines={pipes.data ?? []}
          canEdit={canEdit}
          onSaved={onSaved}
          graphRef={graphRef}
          apiRef={editorApi}
        />
      </div>
      {tab === "settings" ? (
        <TeamSettingsPanel
          team={team}
          getGraph={() => graphRef.current()}
          update={(fn) => editorApi.current?.update(fn)}
          bots={bots.data ?? []}
          pipelines={pipes.data ?? []}
          canEdit={canEdit}
          onMetaSaved={() => void d.reload()}
        />
      ) : null}
      {tab === "test" ? <TeamSimulator teamId={id} getGraph={() => graphRef.current()} /> : null}
      {tab === "runs" ? (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {transfers.loading ? <SkeletonRows /> : null}
          {transfers.data?.length === 0 ? <EmptyState title="Sin derivaciones todavía" description="Cada vez que un bot pasa la conversación a otro bot o a una persona, queda registrado acá con el motivo." /> : null}
          <ul className="divide-y divide-border">
            {transfers.data?.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <Badge tone={t.toHuman ? "warning" : t.kind === "loop_guard" || t.kind === "unavailable" ? "danger" : "neutral"}>{KIND_LABEL[t.kind] ?? t.kind}</Badge>
                <span className="font-medium">{t.fromBotId ? botName(t.fromBotId) : "Mensaje nuevo"}</span>
                <ArrowRight className="size-3.5 text-fg-muted" aria-hidden />
                <span className="inline-flex items-center gap-1 font-medium">
                  {t.toHuman ? <Hand className="size-3.5" aria-hidden /> : null}
                  {t.toHuman ? "Atención humana" : botName(t.toBotId)}
                </span>
                {t.intent ? <span className="text-fg-muted">· {INTENT_LABELS[t.intent].split(" (")[0]}</span> : null}
                <span className="basis-full text-[12.5px] text-fg-secondary sm:basis-auto">{t.reason}</span>
                <span className="ml-auto text-[12px] text-fg-muted">
                  {t.version ? `v${t.version} · ` : ""}
                  {formatDateTime(t.createdAt)}
                </span>
                <Link href={`/conversaciones?c=${t.conversationId}`} className="text-[12.5px] underline underline-offset-2">
                  Ver conversación
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === "versions" ? (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          <p className="border-b border-border px-4 py-2.5 text-[12.5px] text-fg-muted">Cada versión fija qué versión de cada bot usa el equipo. Una conversación en curso sigue con la versión con la que empezó hasta que se resuelve.</p>
          {d.data.versions.length === 0 ? <EmptyState title="Sin versiones publicadas" description="Publicá el equipo para que pueda atender conversaciones." /> : null}
          <ul className="divide-y divide-border">
            {d.data.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-medium">v{v.version}</span>
                <span className="text-fg-muted">{formatDateTime(v.publishedAt)}</span>
                <code className="text-[11.5px] text-fg-muted">{v.checksum}</code>
                {v.id === team.publishedVersionId ? <Badge tone="brand">En uso</Badge> : null}
                {canEdit && v.id !== team.publishedVersionId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    loading={busy}
                    onClick={async () => {
                      if (!window.confirm(`¿Recuperar la v${v.version} como borrador? No cambia lo publicado hasta que publiques.`)) return;
                      await call(`/api/v1/teams/${id}/versions/${v.id}/restore`, {}, `Borrador restaurado desde la v${v.version}. Publicá para aplicarlo.`);
                      window.location.reload();
                    }}
                  >
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
