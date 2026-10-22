# Etapa 04 — Bandeja humana real desde Loopchat

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** primera experiencia end-to-end en interfaz propia: visualizar una conversación y responder por el motor Chatwoot.

**Inspeccionar antes:** adaptador Chatwoot etapa 03, tenant/auth etapa 02, componentes visuales, diferencias de API reales y UX requerida en context.

**Implementar:** bandeja compartida con lista/paginación/filtros, hilo ordenado, contenido seguro, adjuntos admitidos, ficha contextual, asignado único, notas internas, estados de conversación y de entrega, enviar/reintentar con prevención de duplicados, actualización en tiempo real mediante mecanismo soportado o polling razonable con backoff. Historial y permisos server-side; colaboración de roles autorizados; mensaje de error claro si ventana/política Meta impide envío.

**No tocar:** bot IA, pipeline definitivo, campañas o envío masivo; nunca intentar saltar ventana de Meta. No afirmar estado `delivered` sin evidencia del proveedor.

**Aceptación:** dos agentes de tenant A pueden ver conversación permitida, uno asignado; mensaje enviado desde Loopchat aparece en Chatwoot y viceversa; nota interna jamás se envía a WhatsApp; el tenant B no ve nada; errores/dedup/refresh probados. Playwright desktop y móvil, lint/typecheck/build. Prueba real Meta solo si token disponible; de otro modo `BLOCKED_EXTERNAL` preciso.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
