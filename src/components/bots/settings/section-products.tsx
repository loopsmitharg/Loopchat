"use client";
import { useState } from "react";
import { useCan } from "@/components/shell/app-shell";
import {
  Note,
  SaveBar,
  SectionCard,
  Toggle,
  useSaveBot,
  type SectionProps,
} from "./shared";
import { CatalogManager } from "./catalog";

export function ProductsSection({ bot, canEdit, onSaved }: SectionProps) {
  const canWriteCatalog = useCan("catalog:write");
  const associated = new Set(bot.productIds);
  return (
    <div className="flex flex-col gap-4">
      <CatalogSettingsForm
        key={`${JSON.stringify(bot.config.catalog)}:${bot.allowedTools.join(",")}`}
        bot={bot}
        canEdit={canEdit}
        onSaved={onSaved}
      />
      <SectionCard
        title="Catálogo de la empresa"
        description="Compartido por todos los bots de la empresa."
      >
        <CatalogManager
          canWrite={canWriteCatalog}
          botId={bot.id}
          associated={associated}
          canAssociate={canEdit}
          onAssociationChange={onSaved}
        />
      </SectionCard>
    </div>
  );
}

function CatalogSettingsForm({ bot, canEdit, onSaved }: SectionProps) {
  const { save, busy } = useSaveBot(bot, onSaved);
  const [useCatalog, setUseCatalog] = useState(
    bot.allowedTools.includes("use_catalog"),
  );
  const [mode, setMode] = useState(bot.config.catalog.mode);
  const [sendPhotos, setSendPhotos] = useState(bot.config.catalog.sendPhotos);
  const associated = new Set(bot.productIds);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const tools = new Set(bot.allowedTools);
        if (useCatalog) tools.add("use_catalog");
        else tools.delete("use_catalog");
        void save({
          ...(bot.mode === "instructions" ? { allowedTools: [...tools] } : {}),
          config: { catalog: { mode, sendPhotos } },
        });
      }}
    >
      <SectionCard
        title="Productos"
        description="El bot consulta el catálogo de tu empresa: busca coincidencias, informa precio y stock solo si están cargados y no inventa productos ni descuentos."
        footer={<SaveBar canEdit={canEdit} busy={busy} />}
      >
        {bot.mode === "instructions" ? (
          <Toggle
            checked={useCatalog}
            disabled={!canEdit}
            onChange={setUseCatalog}
            label="Consultar el catálogo de productos"
          />
        ) : (
          <Note>
            En los bots de flujo visual, la consulta del catálogo se habilita en
            cada paso de IA (herramienta “Consultar catálogo de productos”).
          </Note>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-fg-secondary">
            Productos que puede ofrecer
          </legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="radio"
              name="catalogMode"
              className="mt-0.5"
              checked={mode === "selected"}
              disabled={!canEdit}
              onChange={() => setMode("selected")}
            />
            <span>
              Solo los productos asociados a este bot{" "}
              <span className="text-fg-muted">
                ({associated.size} asociado{associated.size === 1 ? "" : "s"})
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="radio"
              name="catalogMode"
              className="mt-0.5"
              checked={mode === "all"}
              disabled={!canEdit}
              onChange={() => setMode("all")}
            />
            <span>Todo el catálogo activo de la empresa</span>
          </label>
        </fieldset>
        <Toggle
          checked={sendPhotos}
          disabled={!canEdit}
          onChange={setSendPhotos}
          label="Enviar la foto del producto cuando el cliente la pida"
          description="Se envía por WhatsApp como imagen (vía Chatwoot), respetando la ventana de 24 h."
        />
        <Note tone="info">
          Los cambios de precio, stock o descripción se aplican al instante, sin
          tocar las instrucciones. Asociar o quitar productos se aplica al
          publicar una versión.
        </Note>
      </SectionCard>
    </form>
  );
}
