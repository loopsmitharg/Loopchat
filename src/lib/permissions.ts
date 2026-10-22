/**
 * Matriz de permisos V1 (fuente única; documentada en docs/permissions-matrix.md).
 * Se usa en servidor para autorizar y en cliente solo para ocultar acciones.
 */
export type Role = "tenant_admin" | "manager" | "agent" | "viewer";

export const PERMISSIONS = [
  "dashboard:read",
  "conversation:read",
  "conversation:reply", // enviar mensajes (agent: solo si es responsable o la toma)
  "conversation:note",
  "conversation:assign_self",
  "conversation:assign_any",
  "conversation:status",
  "conversation:bot_control",
  "contact:read",
  "contact:write",
  "opportunity:read",
  "opportunity:write",
  "pipeline:configure",
  "task:read",
  "task:write",
  "bot:read",
  "bot:write",
  "bot:publish",
  "knowledge:read",
  "knowledge:write",
  "catalog:read",
  "catalog:write",
  "settings:read",
  "settings:write",
  "members:manage",
  "credentials:manage",
  "usage:read",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = new Set<Permission>(PERMISSIONS);

const manager = new Set<Permission>([
  "dashboard:read",
  "conversation:read",
  "conversation:reply",
  "conversation:note",
  "conversation:assign_self",
  "conversation:assign_any",
  "conversation:status",
  "conversation:bot_control",
  "contact:read",
  "contact:write",
  "opportunity:read",
  "opportunity:write",
  "pipeline:configure",
  "task:read",
  "task:write",
  "bot:read",
  "bot:write",
  "bot:publish",
  "knowledge:read",
  "knowledge:write",
  "catalog:read",
  "catalog:write",
  "settings:read",
  "usage:read",
]);

const agent = new Set<Permission>([
  "dashboard:read",
  "conversation:read",
  "conversation:reply",
  "conversation:note",
  "conversation:assign_self",
  "conversation:status",
  "conversation:bot_control",
  "contact:read",
  "contact:write",
  "opportunity:read",
  "opportunity:write",
  "task:read",
  "task:write",
  "bot:read",
  "knowledge:read",
  "catalog:read",
]);

const viewer = new Set<Permission>([
  "dashboard:read",
  "conversation:read",
  "contact:read",
  "opportunity:read",
  "task:read",
  "bot:read",
  "knowledge:read",
  "catalog:read",
  "usage:read",
]);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  tenant_admin: all,
  manager,
  agent,
  viewer,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  tenant_admin: "Administrador",
  manager: "Manager comercial",
  agent: "Agente",
  viewer: "Solo lectura",
};
