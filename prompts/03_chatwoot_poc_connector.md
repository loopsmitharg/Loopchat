# Etapa 03 — Chatwoot aislado y contrato de integración

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** probar el riesgo técnico principal ANTES de implementar la bandeja entera.

**Inspeccionar antes:** APIs oficiales en versión fijada de Chatwoot, límites Community, Docker requisitos, versión real del proyecto y autorización. Determinar cómo crear/relacionar cuentas y usuarios sin depender de features Enterprise. La Platform API **no** puede administrar por defecto cuentas creadas en la UI u otra clave: verificar aprovisionamiento por la misma Platform App o permisos explícitos antes de construir onboarding.

**Implementar:** stack Docker local de Chatwoot siguiendo artefactos oficiales y versiones fijadas, con DB de Chatwoot separada de DB Loopchat; conectar API server-side mediante adaptador tipado `chatwoot` con paginación, listar conversaciones/mensajes, enviar mensaje, buscar cuenta/assignee (según documentación). Mapeo verificado `tenant_id ↔ account_id` y tests contra cuenta ajena. Crear receptor de eventos Chatwoot idempotente, validar autenticidad según mecanismo **real comprobado** (no inventar header), registrar deduplicación y reconciliación. Fixtures de Chatwoot para tests sin Meta.

**No tocar:** gateway directo a Meta ni copiar código fuente Chatwoot; no exponer tokens Chatwoot en navegador; no escribir visualizaciones finales de inbox.

**Aceptación:** comprobación de ida/vuelta por API en instancia Chatwoot local, recepción de evento test sin duplicación, invalidación de cuenta cruzada, documentación de endpoints verificados y limitaciones; pruebas con fixtures si Docker externo impide ejecutar, marcando claramente `BLOCKED_EXTERNAL` y NO alegar integración probada.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
