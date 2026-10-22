"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import type { TeamAutomation, TeamGraph, TeamSettings } from "@/lib/team/types";
import { Note, SectionCard } from "../settings/shared";
import type { PipelineOpt, TeamBotOpt } from "./team-editor";

type Pipe = PipelineOpt & { stages: { id: string; name: string; kind: string }[] };
const uid = () => `a-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Configuración del equipo: datos generales, reglas de derivación (sin destino, límite de
 * derivaciones seguidas, respaldo) y automatizaciones por eventos del pipeline.
 * Las reglas y automatizaciones son parte del borrador: se aplican al publicar.
 */
export function TeamSettingsPanel({
  team,
  getGraph,
  update,
  bots,
  pipelines,
  canEdit,
  onMetaSaved,
}: {
  team: { id: string; name: string; description: string; channelConnectionId: string | null };
  getGraph: () => TeamGraph;
  update: (fn: (g: TeamGraph) => TeamGraph) => void;
  bots: TeamBotOpt[];
  pipelines: Pipe[];
  canEdit: boolean;
  onMetaSaved: () => void;
}) {
  const toast = useToast();
  const channels = useApi<{ id: string; displayName: string; phoneNumber: string; status: string }[]>("/api/v1/channels");
  const members = useApi<{ members: { userId: string; name: string; role: string; status: string }[] }>("/api/v1/members");
  const [g, setG] = useState<TeamGraph>(() => getGraph());
  const [busy, setBusy] = useState(false);
  const apply = (fn: (x: TeamGraph) => TeamGraph) => {
    setG((x) => fn(x));
    update(fn);
  };
  const setS = (patch: Partial<TeamSettings>) => apply((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  const setA = (id: string, a: TeamAutomation) => apply((x) => ({ ...x, automations: x.automations.map((y) => (y.id === id ? a : y)) }));
  const teamBots = g.nodes.flatMap((n) => (n.type === "bot" ? [bots.find((b) => b.id === n.data.botId)].filter((b): b is TeamBotOpt => Boolean(b)) : []));
  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, label: `${pipelines.length > 1 ? `${p.name} · ` : ""}${s.name}` })));

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api(`/api/v1/teams/${team.id}`, { method: "PATCH", body: { name: fd.get("name"), description: fd.get("description"), channelConnectionId: (fd.get("channel") as string) || null } });
            toast.push("success", "Datos del equipo guardados.");
            onMetaSaved();
          } catch (err) {
            toast.push("error", (err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <SectionCard
          title="Datos del equipo"
          footer={
            canEdit ? (
              <Button type="submit" variant="secondary" loading={busy}>
                Guardar
              </Button>
            ) : null
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre">{(p) => <Input {...p} name="name" defaultValue={team.name} required minLength={2} maxLength={60} disabled={!canEdit} />}</Field>
            <Field label="Número de WhatsApp" hint="Vacío = todos los números. Si un número tiene un equipo activo, el equipo atiende antes que un bot individual.">
              {(p) => (
                <Select {...p} name="channel" defaultValue={team.channelConnectionId ?? ""} disabled={!canEdit}>
                  <option value="">Todos los números</option>
                  {(channels.data ?? [])
                    .filter((c) => c.status !== "disconnected")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName} ({c.phoneNumber})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Descripción">{(p) => <Textarea {...p} name="description" rows={2} maxLength={300} defaultValue={team.description} disabled={!canEdit} />}</Field>
        </SectionCard>
      </form>

      <SectionCard title="Reglas de derivación" description="Se guardan en el borrador y se aplican al publicar.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Si no se identifica la necesidad" hint="Solo para el bot de entrada.">
            {(p) => (
              <Select {...p} value={g.settings.unknownIntent} disabled={!canEdit} onChange={(e) => setS({ unknownIntent: e.target.value as TeamSettings["unknownIntent"] })}>
                <option value="stay">El bot de entrada pregunta y sigue</option>
                <option value="human">Pasar a una persona</option>
              </Select>
            )}
          </Field>
          <Field label="Derivaciones seguidas sin respuesta" hint="Al superarlo, pasa a una persona (evita bucles).">
            {(p) => <Input {...p} type="number" min={1} max={10} value={g.settings.maxConsecutiveTransfers} disabled={!canEdit} onChange={(e) => setS({ maxConsecutiveTransfers: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />}
          </Field>
          <Field label="Si el bot de destino no está disponible">
            {(p) => (
              <Select {...p} value={g.settings.fallback} disabled={!canEdit} onChange={(e) => setS({ fallback: e.target.value as TeamSettings["fallback"] })}>
                <option value="entry">Volver al bot de entrada</option>
                <option value="human">Pasar a una persona</option>
              </Select>
            )}
          </Field>
        </div>
        <Note>Los insultos se detectan sin IA y suspenden a todo el equipo. Cuando una persona toma la conversación, ningún bot responde hasta que alguien lo reanude.</Note>
      </SectionCard>

      <SectionCard title="Automatizaciones del pipeline" description="Acciones automáticas cuando cambia una oportunidad del cliente. Nunca retoman una conversación que está en manos de una persona.">
        {g.automations.length === 0 ? <p className="text-[13px] text-fg-muted">Sin automatizaciones.</p> : null}
        <ul className="flex flex-col gap-3">
          {g.automations.map((a) => (
            <li key={a.id} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-fg-muted">Cuando…</span>
                <Select
                  aria-label="Evento"
                  value={a.trigger.kind === "stage_entered" ? `stage:${a.trigger.stageId}` : `closed:${a.trigger.pipelineId ?? ""}`}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const [k, v] = e.target.value.split(":");
                    setA(a.id, { ...a, trigger: k === "stage" ? { kind: "stage_entered", stageId: v } : { kind: "opportunity_closed", pipelineId: v || null } });
                  }}
                >
                  <optgroup label="La oportunidad llega a la etapa">
                    {stages
                      .filter((s) => s.kind === "open")
                      .map((s) => (
                        <option key={s.id} value={`stage:${s.id}`}>
                          {s.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="La oportunidad se cierra (ganada o perdida)">
                    <option value="closed:">En cualquier pipeline</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={`closed:${p.id}`}>
                        En {p.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-fg-muted">…entonces</span>
                <Select
                  aria-label="Acción"
                  value={a.action.kind === "assign_owner" ? `owner:${a.action.userId}` : a.action.kind === "activate_bot" ? `activate:${a.action.botId}` : `stop:${a.action.botId ?? ""}`}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const [k, v] = e.target.value.split(":");
                    setA(a.id, { ...a, action: k === "owner" ? { kind: "assign_owner", userId: v } : k === "activate" ? { kind: "activate_bot", botId: v } : { kind: "stop_bot", botId: v || null } });
                  }}
                >
                  <optgroup label="Pasar la conversación al bot">
                    {teamBots.map((b) => (
                      <option key={b.id} value={`activate:${b.id}`}>
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Detener el bot">
                    <option value="stop:">Cualquier bot activo</option>
                    {teamBots.map((b) => (
                      <option key={b.id} value={`stop:${b.id}`}>
                        Si está activo {b.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Asignar responsable (si no tiene)">
                    {(members.data?.members ?? [])
                      .filter((m) => m.status === "active" && m.role !== "viewer")
                      .map((m) => (
                        <option key={m.userId} value={`owner:${m.userId}`}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" checked={a.enabled} disabled={!canEdit} onChange={(e) => setA(a.id, { ...a, enabled: e.target.checked })} /> Activa
                </label>
                {canEdit ? (
                  <Button size="sm" variant="ghost" aria-label="Eliminar automatización" onClick={() => apply((x) => ({ ...x, automations: x.automations.filter((y) => y.id !== a.id) }))}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <Button
            size="sm"
            className="self-start"
            disabled={!stages.length}
            onClick={() => {
              const st = stages.find((s) => s.kind === "open");
              const firstBot = teamBots[0];
              if (!st) return;
              apply((x) => ({ ...x, automations: [...x.automations, { id: uid(), enabled: true, trigger: { kind: "stage_entered", stageId: st.id }, action: firstBot ? { kind: "activate_bot", botId: firstBot.id } : { kind: "stop_bot", botId: null } }] }));
            }}
          >
            <Plus className="size-3.5" aria-hidden /> Agregar automatización
          </Button>
        ) : null}
        <p className="text-[12px] text-fg-muted">Ejemplos: cuando la oportunidad pasa a “Cotizado”, que la atienda Seguimiento comercial; cuando se gana o se pierde, detener el bot de ventas.</p>
      </SectionCard>
    </div>
  );
}
