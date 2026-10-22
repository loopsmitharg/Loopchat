# Etapa 02 — Tenants, autenticación, datos y RBAC

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** establecer seguridad y persistencia reales para varias empresas antes de manejar datos de WhatsApp.

**Inspeccionar antes:** esquemas existentes, auth, contratos API, migraciones/lockfile, middleware. Elegir una biblioteca de auth madura según `PROMPT_SYSTEM.md`, sin escribir un sistema de cookies/passwords casero.

**Implementar:** DB PostgreSQL propia separada de Chatwoot, migraciones Drizzle o la herramienta existente, entidades tenant/user/membership/role/invite/subscription básica, sesiones seguras, invitaciones, reset de contraseña, autorización en servidor, tenant actual validado contra membresía, test helpers y seed **exclusivamente demo**. `platform_admin`, `tenant_admin`, `manager`, `agent`, `viewer` según matriz declarada en context. Crear `docs/permissions-matrix.md`. Centralizar verificaciones de permiso y tenant en repositorios/API. Cifrado server-side de campos secretos para futura etapa, sin inventar claves de producción.

**No tocar:** Meta real, consumo IA, inbox real, payments ni despliegue.

**Aceptación:** admin crea tenant de pruebas e invita agente, login/logout/reset funcional en ambiente local, unauthorized/forbidden seguros; integración DB muestra que tenant A no puede leer/escribir IDs de tenant B incluso cambiando parámetros, incluidos admins que no pertenecen a B. Tests automáticos negativos y positivos con DB real y migraciones reproducibles; build verde.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
