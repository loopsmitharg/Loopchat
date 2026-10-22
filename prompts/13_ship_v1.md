# Etapa 13 — Ship V1: build, runbook y prueba completa

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** entregar una V1 ejecutable con evidencia, sin agregar funcionalidades.

**Inspeccionar antes:** status de todas las etapas, `context.md` Definition of Done, ramas/commits, `.env.example`, Docker Compose, backup/restore, política Meta, integraciones y dominio si existe.

**Ejecutar:**
1. Instalar desde lockfile limpio, migrar DB de prueba y iniciar infraestructura; ejecutar lint, typecheck, todos los unit/integration/E2E, auditoría de dependencias y build producción.
2. Inspeccionar consola/logs, TODOS/FIXMEs, placeholders, datos demo en runtime real, secretos, permisos, expiración de sesión, CORS/CSRF, SSRF, rate limiting y acceso cross-tenant.
3. Verificar flujos completos: dos tenants, Meta→Chatwoot→Loopchat inbox→respuesta humana, oportunidad Kanban, bot básico, editor publicado, handoff, cuota/plan, proveedor IA y fallos; con APIs reales solo cuando existan credenciales/autorizaciones. No mezclar fixture con prueba real.
4. Revisar desktop/tablet/móvil, accesibilidad, performance, uploads, backups, restore de prueba y recuperación ante cola caída.
5. Dejar `README.md` con comandos exactos Windows/Linux, `.env.example` exhaustivo (sin secretos), `docs/deployment.md`, `docs/operations.md`, `docs/qa-final.md` y límites conocidos. Deploy de producción **solo si existe autorización y configuración completa**.
6. Eliminar partes incompletas y falsas promesas; corregir antes de etiquetar release. Marcar `SHIPPED` únicamente cuando todos los checks críticos se demostraron; de lo contrario `VERIFIED_LOCAL`/`BLOCKED_EXTERNAL` con lista concreta de desbloqueos y tests pendientes.

**No tocar:** scope, dependencias nuevas sin justificación crítica, pagos externos no autorizados, datos productivos existentes.

**Aceptación:** V1 reproduce procedimientos de instalación/restore y pasa criterios de `context.md`; evidencia fechada, comandos, capturas, problemas residuales y pasos exactos para poner en producción sin omitir bloqueos reales.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
