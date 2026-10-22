"use client";
import { useRef, useState } from "react";
import { FileText, HelpCircle, Trash2, Upload } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type Src = { id: string; kind: "faq" | "text" | "file"; title: string; status: "ready" | "failed"; error: string | null; sizeBytes: number | null; charCount: number; createdAt: string };

export function KnowledgeSettings() {
  const list = useApi<Src[]>("/api/v1/knowledge");
  const canWrite = useCan("knowledge:write");
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-fg-secondary">
        Los bots consultan estas fuentes con búsqueda de texto. Formatos: TXT, MD y PDF con texto (máx. 5 MB). No se hace OCR: un PDF escaneado se marca como fallido.
      </p>
      {canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Nueva pregunta frecuente">
            <form
              className="flex flex-col gap-3 p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const fd = new FormData(form);
                setBusy("faq");
                try {
                  await api("/api/v1/knowledge/faq", { body: { question: fd.get("q"), answer: fd.get("a") } });
                  form.reset();
                  void list.reload();
                } catch (err) {
                  toast.push("error", (err as ApiError).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Field label="Pregunta">{(p) => <Input {...p} name="q" required minLength={3} placeholder="¿Hacen envíos a domicilio?" />}</Field>
              <Field label="Respuesta">{(p) => <Textarea {...p} name="a" required rows={3} />}</Field>
              <Button type="submit" variant="secondary" loading={busy === "faq"} className="self-end">
                Agregar
              </Button>
            </form>
          </Panel>
          <Panel title="Subir documento">
            <div className="flex flex-col gap-3 p-4">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                aria-label="Archivo"
                className="text-[13px] file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px]"
              />
              <Button
                variant="secondary"
                loading={busy === "file"}
                className="self-end"
                onClick={async () => {
                  const f = fileRef.current?.files?.[0];
                  if (!f) return toast.push("error", "Elegí un archivo.");
                  if (f.size > 5 * 1024 * 1024) return toast.push("error", "El archivo supera los 5 MB.");
                  const fd = new FormData();
                  fd.append("file", f);
                  setBusy("file");
                  try {
                    const r = await api<Src>("/api/v1/knowledge/upload", { body: fd });
                    if (r.status === "failed") toast.push("error", `No se incorporó: ${r.error}`);
                    else toast.push("success", `${r.title}: ${r.charCount.toLocaleString("es-AR")} caracteres incorporados.`);
                    if (fileRef.current) fileRef.current.value = "";
                    void list.reload();
                  } catch (err) {
                    toast.push("error", (err as ApiError).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Upload className="size-4" aria-hidden /> Subir
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
      <Panel title="Fuentes cargadas">
        {list.loading ? <SkeletonRows rows={3} /> : null}
        {list.data?.length === 0 ? <EmptyState title="Sin fuentes todavía" description="Agregá preguntas frecuentes o documentos para que el bot responda con información de tu empresa." /> : null}
        <ul className="divide-y divide-border">
          {list.data?.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              {s.kind === "faq" ? <HelpCircle className="mt-0.5 size-4 text-fg-muted" aria-hidden /> : <FileText className="mt-0.5 size-4 text-fg-muted" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.title}</p>
                <p className="text-[12px] text-fg-muted">
                  {s.kind === "faq" ? "Pregunta frecuente" : s.kind === "text" ? "Texto" : "Archivo"} · {formatDate(s.createdAt)}
                  {s.status === "ready" ? ` · ${s.charCount.toLocaleString("es-AR")} caracteres` : ""}
                </p>
                {s.error ? <p className="text-[12.5px] text-danger">{s.error}</p> : null}
              </div>
              <Badge tone={s.status === "ready" ? "success" : "danger"}>{s.status === "ready" ? "Disponible" : "Falló"}</Badge>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Eliminar ${s.title}`}
                  onClick={async () => {
                    if (!window.confirm(`¿Eliminar "${s.title}"?`)) return;
                    await api(`/api/v1/knowledge/${s.id}`, { method: "DELETE" }).catch((e: ApiError) => toast.push("error", e.message));
                    void list.reload();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
