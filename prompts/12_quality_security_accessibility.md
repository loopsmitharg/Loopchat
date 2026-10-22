# Etapa 12 — QA integral, seguridad, responsive y performance

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** cerrar defectos, cobertura y calidad del MVP existente. Sin features nuevas.

**Inspeccionar antes:** TODO/FIXME, E2E existentes, dependencias, informe status, capturas a 1440/768/390, flows críticos, audit logs y límites de infraestructura.

**Implementar:** corregir bugs/regresiones; tests de aislamiento con URLs/IDs cruzados y eventos async, XSS/rate limits/CSRF segun stack, carga de archivos, secrets redaction, política Meta, retries, quotas, roles y hands-off; pruebas de concurrencia pequeñas, page performance, navegación teclado, contraste y reduced motion. Endurecer errores/loading/offline, ampliar Playwright flujos críticos con fixtures reproducibles. Revisar licencias Chatwoot CE/React Flow/dependencias y atribuciones. Verificar backup restore en entorno temporal.

**No tocar:** roadmap V2, rediseño completo, nuevas integraciones, cambios estéticos incompatibles o producción.

**Aceptación:** lint/typecheck/unit/integration/E2E/build sin fallas; capturas desktop/tablet/móvil revisadas; no fuga A/B ni credenciales, errores críticos corregidos. Documentar métricas medidas y tests NO ejecutados en vez de asumir `PASS`.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
