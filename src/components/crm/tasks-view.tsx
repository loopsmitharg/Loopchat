"use client";
import Link from "next/link";
import { useState } from "react";
import { Bot, CheckCircle2, XCircle } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type Task = { id: string; title: string; description: string | null; status: string; dueAt: string | null; assigneeName: string | null; contactId: string | null; contactName: string | null; opportunityId: string | null; opportunityTitle: string | null; createdByKind: string };

export function TasksView() {
  const [now] = useState(() => Date.now());
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<"pending" | "done" | "cancelled">("pending");
  const tasks = useApi<Task[]>(`/api/v1/tasks?scope=${scope}&status=${status}`);
  const members = useApi<{ members: { userId: string; name: string; status: string }[] }>("/api/v1/members");
  const canWrite = useCan("task:write");
  const toast = useToast();
  const [form, setForm] = useState({ title: "", dueAt: "", assigneeUserId: "" });

  async function setTaskStatus(id: string, s: "done" | "cancelled" | "pending") {
    try {
      await api(`/api/v1/tasks/${id}`, { method: "PATCH", body: { status: s } });
      void tasks.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Tareas"
        description="Seguimientos y recordatorios del equipo."
        actions={
          <>
            <Select aria-label="Alcance" value={scope} onChange={(e) => setScope(e.target.value as "mine" | "all")} className="w-36">
              <option value="mine">Mías</option>
              <option value="all">De todo el equipo</option>
            </Select>
            <Select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as "pending")} className="w-36">
              <option value="pending">Pendientes</option>
              <option value="done">Hechas</option>
              <option value="cancelled">Canceladas</option>
            </Select>
          </>
        }
      />
      {canWrite ? (
        <form
          className="mb-4 flex flex-wrap gap-2 rounded-[10px] border border-border bg-surface p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/v1/tasks", { body: { title: form.title, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null, assigneeUserId: form.assigneeUserId || null } });
              setForm({ title: "", dueAt: "", assigneeUserId: "" });
              void tasks.reload();
            } catch (err) {
              toast.push("error", (err as ApiError).message);
            }
          }}
        >
          <Input aria-label="Título de la tarea" placeholder="Nueva tarea (ej.: llamar a Juan por el presupuesto)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} className="min-w-0 flex-1 basis-64" />
          <Input aria-label="Vencimiento" type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="w-40" />
          <Select aria-label="Responsable" value={form.assigneeUserId} onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })} className="w-48">
            <option value="">Yo</option>
            {members.data?.members
              .filter((m) => m.status === "active")
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
          <Button type="submit" variant="primary">
            Agregar
          </Button>
        </form>
      ) : null}
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        {tasks.loading ? <SkeletonRows /> : null}
        {tasks.error ? <ErrorState description={tasks.error.message} onRetry={() => void tasks.reload()} /> : null}
        {tasks.data?.length === 0 ? <EmptyState title="No hay tareas en esta vista" description={status === "pending" ? "Todo al día." : undefined} /> : null}
        <ul className="divide-y divide-border">
          {tasks.data?.map((t) => {
            const overdue = t.status === "pending" && t.dueAt && new Date(t.dueAt).getTime() < now;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", t.status !== "pending" && "text-fg-muted line-through")}>
                    {t.createdByKind === "bot" ? <Bot className="mr-1 inline size-3.5 text-secondary-strong" aria-label="Creada por el bot" /> : null}
                    {t.title}
                  </p>
                  <p className="text-[12px] text-fg-muted">
                    {t.assigneeName ?? "Sin responsable"}
                    {t.contactId ? (
                      <>
                        {" · "}
                        <Link href={`/contactos/${t.contactId}`} className="underline underline-offset-2">
                          {t.contactName}
                        </Link>
                      </>
                    ) : null}
                    {t.opportunityId ? (
                      <>
                        {" · "}
                        <Link href={`/pipeline?op=${t.opportunityId}`} className="underline underline-offset-2">
                          {t.opportunityTitle}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <span className={cn("text-[12.5px] tabular", overdue ? "font-medium text-danger" : "text-fg-muted")}>{t.dueAt ? `${overdue ? "Venció " : "Vence "}${formatDate(t.dueAt)}` : "Sin fecha"}</span>
                {canWrite && t.status === "pending" ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setTaskStatus(t.id, "done")}>
                      <CheckCircle2 className="size-3.5" aria-hidden /> Hecha
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTaskStatus(t.id, "cancelled")} aria-label={`Cancelar tarea ${t.title}`}>
                      <XCircle className="size-3.5" aria-hidden />
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
