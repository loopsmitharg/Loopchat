import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, opportunities, stages, user as userTable } from "../db/schema";
import { actorUserId, assertCan, type Ctx } from "../authz/context";
import { audit } from "./audit";

/** Celda CSV segura (comillas y protección contra inyección de fórmulas en planillas). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]) {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Exportación básica de datos de la empresa (context.md §7). Solo administradores. */
export async function exportTenantData(ctx: Ctx, type: "contacts" | "opportunities") {
  assertCan(ctx, "settings:write");
  let csv: string;
  if (type === "contacts") {
    const rows = await db.select().from(contacts).where(eq(contacts.tenantId, ctx.tenantId)).orderBy(asc(contacts.createdAt));
    csv = toCsv(["id", "nombre", "telefono_e164", "email", "etiquetas", "notas", "creado"], rows.map((c) => [c.id, c.name, c.phoneE164, c.email, c.tags, c.notes, c.createdAt]));
  } else {
    const rows = await db
      .select({ o: opportunities, stage: stages.name, contact: contacts.name, owner: userTable.name })
      .from(opportunities)
      .innerJoin(stages, eq(stages.id, opportunities.stageId))
      .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
      .leftJoin(userTable, eq(userTable.id, opportunities.ownerUserId))
      .where(eq(opportunities.tenantId, ctx.tenantId))
      .orderBy(asc(opportunities.createdAt));
    csv = toCsv(
      ["id", "titulo", "contacto", "etapa", "estado", "importe", "moneda", "responsable", "origen", "seguimiento", "creada", "cerrada"],
      rows.map((r) => [r.o.id, r.o.title, r.contact, r.stage, r.o.status, r.o.amount, r.o.currency, r.owner, r.o.source, r.o.followUpAt, r.o.createdAt, r.o.closedAt]),
    );
  }
  await audit({ tenantId: ctx.tenantId, actorUserId: actorUserId(ctx), action: "export.downloaded", data: { type } });
  return csv;
}
