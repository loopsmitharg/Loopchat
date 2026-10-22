# Etapa 10 — Planes, cuotas y panel SaaS

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** comercialización real con planes y restricciones combinadas, sin integrar pagos automáticos aún.

**Inspeccionar antes:** roles, entidades comerciales, modelos de IA/WhatsApp y contadores existentes; verificar origen de cada unidad de consumo.

**Implementar:** planes editables iniciales Starter/Growth/Pro con límites propuestos en `context.md`, suscripción por tenant (`trial|active|past_due|suspended|cancelled`), panel operador Loop Smiths para activar/cambiar/suspender, medición idempotente por periodo de números/agentes/bots/pipelines/llamadas de IA; checks de cuota en **backend y workers** antes de ejecutar acción; vista de utilización y alertas. Mantener lectura/histórico accesible al superar cuota de escritura o ejecución según política documentada. Guardar qué cuota/actor bloqueó y mensaje de UX.

**No tocar:** Stripe/Mercado Pago, tax invoices, cobros API en nombres de clientes, tasas Meta hardcodeadas ni sobrecargos automáticos sin consentimiento.

**Aceptación:** cambiar plan altera límites inmediatamente; bajo presión de dos requests concurrentes no se superan cuotas; suspensión no permite respuestas automáticas pero permite acceso de lectura autorizado; eventos duplicados no aumentan consumo; A/B aislado; pruebas unitarias/DB/integración/UI pasan.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
