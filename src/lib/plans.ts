import type { PlanLimits } from "@/server/db/schema";

/** Defaults editables (context.md §4.5). No son precios comerciales. */
export const DEFAULT_PLANS: { code: string; name: string; limits: PlanLimits }[] = [
  {
    code: "starter",
    name: "Starter",
    limits: { whatsappNumbers: 1, agents: 3, pipelines: 1, activeBots: 1, aiCallsPerMonth: 2000, editor: "basic" },
  },
  {
    code: "growth",
    name: "Growth",
    limits: { whatsappNumbers: 2, agents: 10, pipelines: 5, activeBots: 5, aiCallsPerMonth: 10000, editor: "full" },
  },
  {
    code: "pro",
    name: "Pro",
    limits: { whatsappNumbers: 5, agents: 25, pipelines: null, activeBots: 15, aiCallsPerMonth: 50000, editor: "full" },
  },
];

export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  whatsappNumbers: "Números de WhatsApp",
  agents: "Usuarios (agentes)",
  pipelines: "Pipelines",
  activeBots: "Bots activos",
  aiCallsPerMonth: "Llamadas de IA / mes",
  editor: "Editor visual",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trial: "Prueba",
  active: "Activa",
  past_due: "Pago pendiente",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

/** Estados en los que la empresa puede ejecutar acciones nuevas (bots, envíos, altas). */
export const OPERATIONAL_STATUSES = new Set(["trial", "active", "past_due"]);
