# Etapa 06 — IA BYOK y bot básico con transferencia humana

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** bot real que responde por WhatsApp, usa credencial del tenant, interactúa con CRM y cede control al humano.

**Inspeccionar antes:** flujos de mensajes, permisos, modelo de eventos, custodia de claves y límites API actuales.

**Implementar:** vault/almacenamiento cifrado por empresa, conexión/revocación/test de credenciales sin eco de secretos, proveedores adaptables (mínimo uno OpenAI-compatible y otro no idéntico), selección explícita de modelo por admin, prompt por bot, FAQ inicial, herramientas **allowlist** para crear/actualizar negocio o clasificar y escalar, logs redacted. Runtime del bot básico activado por eventos de inbox con idempotencia/reintentos y límite de concurrencia. Estado human/bot/paused persistente; política de no envío concurrente; fallback ante fallo del proveedor o timeout.

**No tocar:** construir grafo visual todavía, entrenamiento personalizado de modelos, proveedor IA universal, salidas por Meta fuera de Chatwoot.

**Aceptación:** mensaje→respuesta bot→Chatwoot→chat con trazabilidad; bot crea oportunidad/etapa cuando permitido; humano toma chat y bot no responde, reanuda por acción autorizada. A/B usa diferentes credenciales sin filtración. Tests adapter fakes + tests de integración por API real si hay credenciales; falta de claves es `BLOCKED_EXTERNAL`, no `PASS` ficticio.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
