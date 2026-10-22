"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useCan } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type Conn = { id: string; provider: "openai_compatible" | "anthropic" | "gemini"; label: string; baseUrl: string | null; keyHint: string; defaultModel: string; status: string; lastVerifiedAt: string | null; lastError: string | null };
const PROVIDERS = {
  openai_compatible: { label: "OpenAI o compatible", hint: "gpt-4o-mini", base: true },
  anthropic: { label: "Anthropic (Claude)", hint: "claude-haiku-4-5", base: false },
  gemini: { label: "Google Gemini", hint: "gemini-2.5-flash", base: false },
} as const;
const STATUS: Record<string, { label: string; tone: "success" | "danger" | "neutral" | "warning" }> = {
  verified: { label: "Verificada", tone: "success" },
  unverified: { label: "Sin verificar", tone: "warning" },
  error: { label: "Con error", tone: "danger" },
  revoked: { label: "Revocada", tone: "neutral" },
};

export function AiSettings() {
  const list = useApi<Conn[]>("/api/v1/ai-connections");
  const canManage = useCan("credentials:manage");
  const toast = useToast();
  const [provider, setProvider] = useState<Conn["provider"]>("openai_compatible");
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, path: string, body: unknown, method = "POST") {
    setBusy(id);
    try {
      const r = await api<Conn | { ok: true }>(path, { method, body });
      if ("status" in r && r.status === "error") toast.push("error", `La prueba falló: ${r.lastError}`);
      else toast.push("success", "Listo.");
      void list.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-fg-secondary">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-secondary-strong" aria-hidden /> Las claves se guardan cifradas, solo se usan desde el servidor y nunca se muestran completas. Cada llamada se cobra en la cuenta de tu empresa con el proveedor.
      </p>
      <Panel title="Conexiones">
        {list.loading ? <SkeletonRows rows={2} /> : null}
        {list.data?.length === 0 ? <EmptyState title="Sin proveedores configurados" description="Agregá al menos uno para usar bots con IA." /> : null}
        <ul className="divide-y divide-border">
          {list.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.label} <span className="font-normal text-fg-muted">· {PROVIDERS[c.provider].label}</span>
                </p>
                <p className="text-[12px] text-fg-muted">
                  Modelo {c.defaultModel} · Clave {c.keyHint}
                  {c.baseUrl ? ` · ${c.baseUrl}` : ""} · Última prueba {formatDateTime(c.lastVerifiedAt)}
                </p>
                {c.lastError ? <p className="mt-1 text-[12.5px] text-danger">{c.lastError}</p> : null}
              </div>
              <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              {canManage && c.status !== "revoked" ? (
                <span className="flex gap-1.5">
                  <Button size="sm" loading={busy === c.id} onClick={() => act(c.id, `/api/v1/ai-connections/${c.id}/test`, {})}>
                    Probar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const key = window.prompt("Pegá la nueva clave (se guarda cifrada):");
                      if (key) void act(c.id, `/api/v1/ai-connections/${c.id}/rotate`, { apiKey: key });
                    }}
                  >
                    Rotar clave
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm("¿Revocar esta conexión? Los bots que la usan derivarán a humano hasta que elijas otra.")) void act(c.id, `/api/v1/ai-connections/${c.id}`, undefined, "DELETE");
                    }}
                  >
                    Revocar
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
      {canManage ? (
        <Panel title="Agregar proveedor">
          <form
            className="grid gap-3 p-4 md:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              setBusy("new");
              try {
                const c = await api<Conn>("/api/v1/ai-connections", { body: { provider, label: fd.get("label"), apiKey: fd.get("apiKey"), baseUrl: PROVIDERS[provider].base ? fd.get("baseUrl") || undefined : undefined, defaultModel: fd.get("model") } });
                form.reset();
                toast.push("success", "Conexión guardada. Probándola…");
                await act(c.id, `/api/v1/ai-connections/${c.id}/test`, {});
              } catch (err) {
                toast.push("error", (err as ApiError).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            <Field label="Proveedor">
              {(p) => (
                <Select {...p} value={provider} onChange={(e) => setProvider(e.target.value as Conn["provider"])}>
                  {Object.entries(PROVIDERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Nombre">{(p) => <Input {...p} name="label" required minLength={2} placeholder="Cuenta principal" />}</Field>
            <Field label="Modelo por defecto" hint={`Ej.: ${PROVIDERS[provider].hint}`}>
              {(p) => <Input {...p} name="model" required placeholder={PROVIDERS[provider].hint} />}
            </Field>
            {PROVIDERS[provider].base ? (
              <Field label="URL base (opcional)" hint="Para proveedores compatibles. Vacío = OpenAI. Debe ser https.">
                {(p) => <Input {...p} name="baseUrl" type="url" placeholder="https://api.openai.com/v1" />}
              </Field>
            ) : (
              <div />
            )}
            <Field label="API key" className="md:col-span-2">
              {(p) => <Input {...p} name="apiKey" type="password" required minLength={10} autoComplete="off" />}
            </Field>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" variant="primary" loading={busy === "new"}>
                Guardar y probar
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}
