"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ImageOff, ImagePlus, Package, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

export type Product = {
  id: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  stock: number | null;
  availability: "unknown" | "in_stock" | "out_of_stock";
  active: boolean;
  archived: boolean;
  hasPhoto: boolean;
  photoUrl: string | null;
  bots: { id: string; name: string }[];
};

function StockBadge({ p }: { p: Pick<Product, "stock"> }) {
  if (p.stock === null) return <Badge>Stock sin especificar</Badge>;
  if (p.stock === 0) return <Badge tone="danger">Sin stock</Badge>;
  return <Badge tone="success">{p.stock} disponibles</Badge>;
}

/**
 * Catálogo de la empresa (compartido por todos sus bots). Con `botId`, permite asociar
 * productos a ese bot (la asociación se aplica al publicar; precio y stock, al instante).
 */
export function CatalogManager({ canWrite, botId, associated, onAssociationChange, canAssociate }: { canWrite: boolean; botId?: string; associated?: Set<string>; onAssociationChange?: () => void; canAssociate?: boolean }) {
  const [q, setQ] = useState("");
  const [availability, setAvailability] = useState("all");
  const [status, setStatus] = useState("all");
  const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), availability, status }).toString();
  const list = useApi<Product[]>(`/api/v1/products?${qs}`);
  const toast = useToast();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // estado optimista de la asociación (se confirma al recargar el bot)
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.push("success", ok);
      void list.reload();
      onAssociationChange?.();
      return true;
    } catch (e) {
      toast.push("error", (e as ApiError).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Buscar productos</span>
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título o descripción" className="pl-8" />
        </label>
        <label className="text-[12.5px]">
          <span className="sr-only">Disponibilidad</span>
          <Select value={availability} onChange={(e) => setAvailability(e.target.value)} className="w-auto">
            <option value="all">Toda disponibilidad</option>
            <option value="in_stock">Con stock</option>
            <option value="out_of_stock">Sin stock</option>
            <option value="unknown">Stock sin especificar</option>
          </Select>
        </label>
        <label className="text-[12.5px]">
          <span className="sr-only">Estado</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="all">Activos e inactivos</option>
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos</option>
            <option value="archived">Archivados</option>
          </Select>
        </label>
        {canWrite ? (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Nuevo producto
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border">
        {list.loading && !list.data ? <SkeletonRows rows={3} /> : null}
        {list.error ? <ErrorState description={list.error.message} onRetry={() => void list.reload()} /> : null}
        {list.data && list.data.length === 0 ? (
          <EmptyState
            icon={<Package className="size-5" aria-hidden />}
            title={q || availability !== "all" || status !== "all" ? "No hay productos con esos filtros" : "Todavía no hay productos"}
            description="Cargá título y descripción (obligatorios). Precio, stock y foto son opcionales: si no los cargás, el bot no los inventa."
          />
        ) : null}
        <ul className="divide-y divide-border">
          {list.data?.map((p) => {
            const isOn = pending[p.id] ?? associated?.has(p.id) ?? false;
            return (
              <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", (!p.active || p.archived) && "bg-surface-muted/50")}>
                <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por la API con control de acceso */}
                  {p.photoUrl ? <img src={p.photoUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="flex size-full items-center justify-center text-fg-muted"><Package className="size-5" aria-hidden /></div>}
                </div>
                <div className="min-w-[180px] flex-1">
                  <p className="text-[13.5px] font-medium">{p.title}</p>
                  <p className="line-clamp-1 text-[12.5px] text-fg-muted">{p.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-medium tabular">{p.price === null ? "Precio sin cargar" : formatMoney(p.price, p.currency)}</span>
                    <StockBadge p={p} />
                    {p.archived ? <Badge tone="warning">Archivado</Badge> : !p.active ? <Badge>Inactivo</Badge> : null}
                    {p.bots.length ? <span className="text-[12px] text-fg-muted">Bots: {p.bots.map((b) => b.name).join(", ")}</span> : <span className="text-[12px] text-fg-muted">Ningún bot lo usa</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {botId && !p.archived ? (
                    <label className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]", isOn ? "border-brand-strong bg-brand-soft/60" : "border-border")}>
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled={!canAssociate || busy === p.id}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setPending((x) => ({ ...x, [p.id]: on }));
                          void act(p.id, () => api(`/api/v1/bots/${botId}/products`, { body: on ? { add: [p.id] } : { remove: [p.id] } }), on ? "Producto asociado. Publicá para aplicarlo." : "Producto quitado. Publicá para aplicarlo.").then((done) => {
                            // si falló, se vuelve al estado real
                            if (!done)
                              setPending((x) => {
                                const n = { ...x };
                                delete n[p.id];
                                return n;
                              });
                          });
                        }}
                      />
                      Usa este bot
                    </label>
                  ) : null}
                  {canWrite && !p.archived ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Editar ${p.title}`}>
                        <Pencil className="size-3.5" aria-hidden /> Editar
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => window.confirm(`¿Eliminar "${p.title}" del catálogo? Se archiva: deja de ofrecerse, pero se conserva para el historial.`) && act(p.id, () => api(`/api/v1/products/${p.id}`, { method: "DELETE" }), "Producto archivado.")} aria-label={`Eliminar ${p.title}`}>
                        <Archive className="size-3.5" aria-hidden /> Eliminar
                      </Button>
                    </>
                  ) : null}
                  {canWrite && p.archived ? (
                    <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => act(p.id, () => api(`/api/v1/products/${p.id}/restore`, { body: {} }), "Producto restaurado (queda inactivo hasta que lo actives).")}>
                      <RotateCcw className="size-3.5" aria-hidden /> Restaurar
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {editing ? (
        <ProductModal
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void list.reload();
            onAssociationChange?.();
          }}
        />
      ) : null}
    </div>
  );
}

function ProductModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState<Product | null>(product);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const preview = useMemo(() => (pendingPhoto ? URL.createObjectURL(pendingPhoto) : null), [pendingPhoto]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  async function uploadPhoto(id: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return api<Product>(`/api/v1/products/${id}/photo`, { body: fd });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={current ? "Editar producto" : "Nuevo producto"}
      description="Título y descripción son obligatorios. Precio, stock y foto son opcionales."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => formRef.current?.requestSubmit()}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        className="grid gap-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const price = String(fd.get("price") ?? "").trim();
          const stock = String(fd.get("stock") ?? "").trim();
          const body = { title: fd.get("title"), description: fd.get("description"), price: price === "" ? null : price, stock: stock === "" ? null : stock, active: fd.get("active") === "on" };
          setBusy(true);
          setError(null);
          try {
            const saved = current ? await api<Product>(`/api/v1/products/${current.id}`, { method: "PATCH", body }) : await api<Product>("/api/v1/products", { body });
            if (pendingPhoto) await uploadPhoto(saved.id, pendingPhoto);
            toast.push("success", current ? "Producto actualizado. El bot usa los datos nuevos al instante." : "Producto creado.");
            onSaved();
            onClose();
          } catch (err) {
            setError((err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Título *" className="md:col-span-2">{(p) => <Input {...p} name="title" required maxLength={120} defaultValue={current?.title ?? ""} placeholder="Taladro percutor 13 mm 750 W" />}</Field>
        <Field label="Descripción *" className="md:col-span-2" hint="Características, usos, medidas o información comercial. El bot la usa para responder.">
          {(p) => <Textarea {...p} name="description" required rows={4} maxLength={4000} defaultValue={current?.description ?? ""} />}
        </Field>
        <Field label="Precio (opcional)" hint="Vacío = el bot dice que no tiene el precio y ofrece consultarlo.">
          {(p) => <Input {...p} name="price" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" defaultValue={current?.price ?? ""} placeholder="85000" />}
        </Field>
        <Field label="Stock (opcional)" hint="Vacío = sin especificar (no es lo mismo que 0). No se descuenta solo.">
          {(p) => <Input {...p} name="stock" inputMode="numeric" pattern="\d+" defaultValue={current?.stock ?? ""} placeholder="Sin especificar" />}
        </Field>
        <label className="flex items-center gap-2 text-[13px] md:col-span-2">
          <input type="checkbox" name="active" defaultChecked={current?.active ?? true} /> Activo (los bots solo ofrecen productos activos)
        </label>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 md:col-span-2">
          <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local o imagen privada de la API */}
            {preview ? <img src={preview} alt="Vista previa" className="size-full object-cover" /> : current?.photoUrl ? <img src={current.photoUrl} alt={`Foto de ${current.title}`} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-fg-muted"><ImageOff className="size-5" aria-hidden /></div>}
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <p className="text-[13px] font-medium">Fotografía (opcional)</p>
            <p className="text-[12px] text-fg-muted">JPG, PNG o WEBP hasta 5 MB. Se valida el tipo real del archivo.</p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Elegir foto"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 5 * 1024 * 1024) {
                    setError("La foto supera los 5 MB.");
                    return;
                  }
                  setError(null);
                  setPendingPhoto(f);
                }}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="size-3.5" aria-hidden /> {current?.hasPhoto || pendingPhoto ? "Reemplazar" : "Subir foto"}
              </Button>
              {current?.hasPhoto && !pendingPhoto ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      setCurrent(await api<Product>(`/api/v1/products/${current.id}/photo`, { method: "DELETE" }));
                      onSaved();
                    } catch (err) {
                      setError((err as ApiError).message);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden /> Quitar foto
                </Button>
              ) : null}
              {pendingPhoto ? (
                <Button size="sm" variant="ghost" onClick={() => setPendingPhoto(null)}>
                  Descartar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-[12.5px] text-danger md:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
