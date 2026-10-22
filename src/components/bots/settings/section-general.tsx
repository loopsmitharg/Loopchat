"use client";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ROLE_ORDER, ROLE_TEMPLATES } from "@/lib/team/roles";
import { SaveBar, SectionCard, useSaveBot, type Channel, type Conn, type SectionProps } from "./shared";

export function GeneralSection({ bot, canEdit, onSaved, connections, channels }: SectionProps & { connections: Conn[]; channels: Channel[] }) {
  const { save, busy } = useSaveBot(bot, onSaved);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void save({
          name: fd.get("name"),
          role: fd.get("role"),
          aiConnectionId: fd.get("conn") || null,
          model: fd.get("model") || null,
          channelConnectionId: fd.get("channel") || null,
          config: { identity: { displayName: String(fd.get("displayName") ?? ""), showName: fd.get("showName") === "on", description: String(fd.get("description") ?? ""), specialization: String(fd.get("specialization") ?? "") } },
        });
      }}
    >
      <SectionCard title="Identidad" description="Quién es este bot: nombre, rol, función, número de WhatsApp y proveedor de IA. El rol es una plantilla inicial, no una restricción (salvo la recepcionista, que nunca crea ni mueve oportunidades)." footer={<SaveBar canEdit={canEdit} busy={busy} />}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre interno">{(p) => <Input {...p} name="name" defaultValue={bot.name} disabled={!canEdit} required minLength={2} maxLength={60} />}</Field>
          <Field label="Nombre visible para el cliente" hint="Solo se usa si marcás “Presentarse con este nombre”.">
            {(p) => <Input {...p} name="displayName" defaultValue={bot.config.identity.displayName} disabled={!canEdit} maxLength={60} placeholder="Ej.: Sofía" />}
          </Field>
          <label className="flex items-center gap-2 text-[13px] md:col-span-2">
            <input type="checkbox" name="showName" defaultChecked={bot.config.identity.showName} disabled={!canEdit} /> Presentarse con este nombre (si no, el bot no inventa un nombre propio)
          </label>
          <Field label="Descripción de su función" className="md:col-span-2">
            {(p) => <Textarea {...p} name="description" rows={2} defaultValue={bot.config.identity.description} disabled={!canEdit} maxLength={400} placeholder="Ej.: Atiende consultas de precios y arma presupuestos de herramientas eléctricas." />}
          </Field>
          <Field label="Especialización (opcional)">{(p) => <Input {...p} name="specialization" defaultValue={bot.config.identity.specialization} disabled={!canEdit} maxLength={200} placeholder="Ej.: herramientas eléctricas y jardinería" />}</Field>
          <Field label="Rol" hint={ROLE_TEMPLATES[bot.role]?.short}>
            {(p) => (
              <Select {...p} name="role" defaultValue={bot.role} disabled={!canEdit}>
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_TEMPLATES[r].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Número de WhatsApp" hint="Vacío = aplica a todos los números de la empresa.">
            {(p) => (
              <Select {...p} name="channel" defaultValue={bot.channelConnectionId ?? ""} disabled={!canEdit}>
                <option value="">Todos los números</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.phoneNumber})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Proveedor de IA" hint={connections.length ? "Se usa la API key de tu empresa." : "Configurá una conexión en Configuración → IA."}>
            {(p) => (
              <Select {...p} name="conn" defaultValue={bot.aiConnectionId ?? ""} disabled={!canEdit}>
                <option value="">Sin IA</option>
                {connections
                  .filter((c) => c.status !== "revoked")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {c.defaultModel} {c.status !== "verified" ? "(sin verificar)" : ""}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Modelo" hint="Vacío = el modelo por defecto de la conexión.">{(p) => <Input {...p} name="model" defaultValue={bot.model ?? ""} disabled={!canEdit} maxLength={100} />}</Field>
        </div>
      </SectionCard>
    </form>
  );
}
