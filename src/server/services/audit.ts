import "server-only";
import { db, type Tx } from "../db";
import { auditLogs } from "../db/schema";
import { redact } from "../log";

export type AuditInput = {
  tenantId: string | null;
  actorUserId?: string | null;
  actorKind?: "user" | "bot" | "system" | "platform";
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  ip?: string | null;
};

export async function audit(input: AuditInput, tx?: Tx) {
  const runner = tx ?? db;
  await runner.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    actorKind: input.actorKind ?? "user",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    data: input.data ? (redact(input.data) as Record<string, unknown>) : undefined,
    ip: input.ip ?? null,
  });
}
