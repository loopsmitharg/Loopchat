export const STATUS_LABEL: Record<string, string> = { open: "Abierta", pending: "Pendiente", resolved: "Resuelta", snoozed: "Pospuesta" };
export const MODE_LABEL: Record<string, string> = { bot: "Bot", requested: "Pide humano", human: "Humano", paused: "Bot pausado" };
export const HANDOFF_LABEL: Record<string, string> = { insult_detection: "Insulto o agresión detectada (sin IA)", keyword: "Palabra clave de derivación", ai: "La IA pidió una persona", max_attempts: "Consultas sin resolver", out_of_hours: "Fuera de horario", flow: "Paso del flujo", error: "Falla del bot", quota: "Cupo de IA agotado", no_ai: "Sin proveedor de IA", team_route: "Derivación del equipo de bots", high_value: "Oportunidad de alto valor", tool_error: "Error al ejecutar una acción", usage_limit: "Límite de uso de IA" };
export const ACTIVITY_LABEL: Record<string, string> = {
  assigned: "Asignada",
  unassigned: "Sin responsable",
  handoff: "Pasó a humano",
  bot_resumed: "Bot reanudado",
  bot_paused: "Bot pausado",
  bot_transfer: "Derivación interna entre bots",
  status_changed: "Cambio de estado",
};
