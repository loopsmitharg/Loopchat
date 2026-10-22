"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { useCan, useSession } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, useApi } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type Data = { members: { membershipId: string; userId: string; name: string; email: string; role: Role; status: string }[]; invitations: { id: string; email: string; role: Role; expiresAt: string }[] };

export function TeamSettings() {
  const d = useApi<Data>("/api/v1/members");
  const canManage = useCan("members:manage");
  const me = useSession().user.id;
  const toast = useToast();
  const [invite, setInvite] = useState<{ email: string; role: Role }>({ email: "", role: "agent" });
  const [devUrl, setDevUrl] = useState<string | null>(null);
  if (d.loading) return <SkeletonRows />;
  if (!d.data) return <ErrorState description={d.error?.message} />;

  async function update(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/v1/members/${id}`, { method: "PATCH", body });
      toast.push("success", "Miembro actualizado.");
      void d.reload();
    } catch (e) {
      toast.push("error", (e as ApiError).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <Panel title="Invitar a alguien" description="Recibe un email con un enlace válido por 7 días.">
          <form
            className="flex flex-wrap gap-2 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api<{ devUrl?: string }>("/api/v1/members/invite", { body: invite });
                toast.push("success", `Invitación enviada a ${invite.email}.`);
                setDevUrl(r.devUrl ?? null);
                setInvite({ email: "", role: "agent" });
                void d.reload();
              } catch (err) {
                toast.push("error", (err as ApiError).message);
              }
            }}
          >
            <Input aria-label="Email" type="email" required placeholder="email@empresa.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className="min-w-0 flex-1 basis-56" />
            <Select aria-label="Rol" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })} className="w-48">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary">
              Invitar
            </Button>
          </form>
          {devUrl ? (
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted px-3 py-2 text-[12px]">
              <span className="font-medium">Desarrollo (sin SMTP):</span>
              <code className="truncate">{devUrl}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(devUrl)} aria-label="Copiar enlace" className="ml-auto">
                <Copy className="size-3.5" />
              </button>
            </div>
          ) : null}
        </Panel>
      ) : null}
      <Panel title="Miembros" description="Un responsable por conversación; el resto del equipo puede leer y dejar notas según su rol.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-fg-muted">
                <th scope="col" className="px-4 py-2 font-medium">Persona</th>
                <th scope="col" className="px-4 py-2 font-medium">Rol</th>
                <th scope="col" className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {d.data.members.map((m) => (
                <tr key={m.membershipId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{m.name}</span>
                    {m.userId === me ? <span className="text-fg-muted"> (vos)</span> : null}
                    <span className="block text-[12px] text-fg-muted">{m.email}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {canManage && m.userId !== me ? (
                      <Select aria-label={`Rol de ${m.name}`} value={m.role} onChange={(e) => update(m.membershipId, { role: e.target.value })} className="h-8 w-44">
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      ROLE_LABELS[m.role]
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status === "active" ? "Activo" : "Deshabilitado"}</Badge>
                      {canManage && m.userId !== me ? (
                        <Button size="sm" variant="ghost" onClick={() => update(m.membershipId, { status: m.status === "active" ? "disabled" : "active" })}>
                          {m.status === "active" ? "Deshabilitar" : "Reactivar"}
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {canManage && d.data.invitations.length ? (
        <Panel title="Invitaciones pendientes">
          <ul className="divide-y divide-border">
            {d.data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="flex-1">{i.email}</span>
                <span className="text-fg-muted">{ROLE_LABELS[i.role]} · vence {formatDate(i.expiresAt)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/v1/invitations/${i.id}`, { method: "DELETE" }).catch((e: ApiError) => toast.push("error", e.message));
                    void d.reload();
                  }}
                >
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
