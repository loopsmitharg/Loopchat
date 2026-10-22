"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

type Row = { id: string; name: string; phoneE164: string | null; email: string | null; tags: string[]; openOpportunities: number; lastMessageAt: string | null };

export function ContactsList() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const data = useApi<{ items: Row[]; hasMore: boolean; page: number }>(`/api/v1/contacts?q=${encodeURIComponent(dq)}&page=${page}`);
  const canWrite = useCan("contact:write");
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Contactos"
        description="Ficha unificada de las personas que hablan con tu empresa."
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Buscar contactos</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o email" className="w-60 pl-8" />
            </label>
            {canWrite ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus className="size-4" aria-hidden /> Nuevo contacto
              </Button>
            ) : null}
          </>
        }
      />
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
        {data.loading ? <SkeletonRows /> : null}
        {data.error ? <ErrorState description={data.error.message} onRetry={() => void data.reload()} /> : null}
        {data.data && data.data.items.length === 0 ? <EmptyState title={dq ? "Sin resultados" : "Todavía no hay contactos"} description={dq ? "Probá con otro nombre o teléfono." : "Se crean automáticamente cuando alguien escribe a tu WhatsApp."} /> : null}
        {data.data && data.data.items.length > 0 ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-fg-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Nombre</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Teléfono</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Etiquetas</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Oport. abiertas</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Último mensaje</th>
              </tr>
            </thead>
            <tbody>
              {data.data.items.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                  <td className="px-4 py-2.5">
                    <Link href={`/contactos/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <Avatar name={c.name} seed={c.id} size={28} />
                      <span className="truncate">{c.name}</span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-2.5 text-fg-secondary tabular sm:table-cell">{formatPhone(c.phoneE164)}</td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <div className="flex flex-wrap gap-1">{c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-fg-muted">—</span>}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{c.openOpportunities}</td>
                  <td className="hidden px-4 py-2.5 text-right text-fg-muted md:table-cell">{formatRelative(c.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {data.data && (data.data.hasMore || page > 1) ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button size="sm" disabled={!data.data.hasMore} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      ) : null}
      <NewContactModal open={open} onClose={() => setOpen(false)} onCreated={() => void data.reload()} />
    </div>
  );
}

function NewContactModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Nuevo contacto">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            await api("/api/v1/contacts", {
              body: {
                name: fd.get("name"),
                phone: fd.get("phone") || null,
                email: fd.get("email") || null,
                tags: String(fd.get("tags") ?? "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              },
            });
            toast.push("success", "Contacto creado.");
            onCreated();
            onClose();
          } catch (err) {
            setError((err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nombre">{(p) => <Input {...p} name="name" required />}</Field>
        <Field label="Teléfono" hint="Formato internacional; se normaliza a E.164.">{(p) => <Input {...p} name="phone" inputMode="tel" placeholder="+54 9 11 1234-5678" />}</Field>
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" />}</Field>
        <Field label="Etiquetas" hint="Separadas por coma.">{(p) => <Input {...p} name="tags" placeholder="mayorista, zona norte" />}</Field>
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}
