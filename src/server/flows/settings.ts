import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { resolveBotConfig, type BotConfig } from "@/lib/bot-config";
import type { AiTool } from "@/lib/flow/types";
import { db } from "../db";
import { botProducts, bots, memberships, type BotRole } from "../db/schema";
import type { CompanySnapshot } from "@/lib/ai-profile";
import { companySnapshot } from "../services/ai-profile";

/**
 * Configuración efectiva de un bot. El runtime ejecuta SIEMPRE lo publicado: si la versión tiene
 * copia de configuración (`settings`) se usa esa; las versiones anteriores a esta función
 * (sin copia) usan los valores del bot, que es como funcionaban antes.
 */
export type BotSettings = {
  /** Rol del bot (recepcionista no crea ni mueve oportunidades). */
  role: BotRole;
  instructions: string;
  allowedTools: AiTool[];
  handoffKeywords: string[];
  aiConnectionId: string | null;
  model: string | null;
  config: BotConfig;
  /** Productos asociados al publicar (solo aplica con catálogo en modo "selected"). */
  productIds: string[];
  /** Identidad, objetivos y políticas (no obligatorias) de la empresa copiadas al publicar. null = versión anterior a esta función. */
  company: CompanySnapshot | null;
};

export type VersionSnapshot = Omit<BotSettings, "config" | "role" | "company"> & { config: unknown; role?: BotRole; company?: CompanySnapshot | null; instructionsVersion?: string };

/** Herramientas efectivas: el rol recepcionista nunca crea ni mueve oportunidades (validado en el servidor). */
export function effectiveTools(settings: Pick<BotSettings, "role" | "config">, tools: AiTool[]): AiTool[] {
  let out = [...new Set(tools)];
  if (settings.role === "receptionist") out = out.filter((t) => t !== "create_opportunity" && t !== "update_stage");
  if (settings.config.pipeline.createOpportunity === "never") out = out.filter((t) => t !== "create_opportunity");
  if (!settings.config.handoff.allowAiHandoff) out = out.filter((t) => t !== "handoff");
  return out;
}

export async function draftSettings(bot: typeof bots.$inferSelect): Promise<BotSettings> {
  const rows = await db.select({ productId: botProducts.productId }).from(botProducts).where(and(eq(botProducts.botId, bot.id), eq(botProducts.tenantId, bot.tenantId)));
  return {
    role: bot.role,
    instructions: bot.instructions,
    allowedTools: bot.allowedTools as AiTool[],
    handoffKeywords: bot.handoffKeywords,
    aiConnectionId: bot.aiConnectionId,
    model: bot.model,
    config: resolveBotConfig(bot.config),
    productIds: rows.map((r) => r.productId),
    // borradores y simulador: la política vigente de la empresa
    company: await companySnapshot(bot.tenantId),
  };
}

export function settingsFromVersion(bot: typeof bots.$inferSelect, versionSettings: unknown, fallbackProductIds: string[] = []): BotSettings {
  const s = (versionSettings ?? null) as Partial<VersionSnapshot> | null;
  if (!s) {
    return {
      role: bot.role,
      instructions: bot.instructions,
      allowedTools: bot.allowedTools as AiTool[],
      handoffKeywords: bot.handoffKeywords,
      aiConnectionId: bot.aiConnectionId,
      model: bot.model,
      config: resolveBotConfig(bot.config),
      productIds: fallbackProductIds,
      company: null,
    };
  }
  return {
    // versiones anteriores a los roles: el rol vigente del bot
    role: (s.role ?? bot.role) as BotRole,
    instructions: s.instructions ?? "",
    allowedTools: (s.allowedTools ?? []) as AiTool[],
    handoffKeywords: s.handoffKeywords ?? [],
    aiConnectionId: s.aiConnectionId ?? null,
    model: s.model ?? null,
    config: resolveBotConfig(s.config),
    productIds: s.productIds ?? [],
    company: s.company ?? null,
  };
}

/** Miembro activo de la empresa que puede atender conversaciones (no "solo lectura"). */
export async function isAssignableMember(tenantId: string, userId: string | null | undefined) {
  if (!userId) return false;
  const m = await db.query.memberships.findFirst({ where: and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active"), ne(memberships.role, "viewer")) });
  return Boolean(m);
}

export async function assignableMembers(tenantId: string, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, userIds), eq(memberships.status, "active"), ne(memberships.role, "viewer")));
  return new Set(rows.map((r) => r.userId));
}
