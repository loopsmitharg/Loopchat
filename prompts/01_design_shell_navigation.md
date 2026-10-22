# Etapa 01 — Sistema visual y navegación funcional

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** construir la interfaz estructural de Loopchat con estilo propio y rutas accesibles para el trabajo posterior.

**Inspeccionar antes:** implementación de etapa 00, tokens visuales, logo real, estructura de Next y rutas disponibles.

**Implementar:** design tokens reutilizables, layout autenticado previsto, navegación lateral/topbar, rutas protegidas de `dashboard`, `conversaciones`, `pipeline`, `contactos`, `chatbots`, `configuración`, sin pantallas infladas de gráficos. Componentes reutilizables de campos, botones, estados, tablas, toast y modales. Datos placeholder solamente en una **vista demo marcada como tal** para diseñar, sin aparentar conectar al backend.

**No tocar:** autenticación real, datos persistidos, APIs WhatsApp, facturación; no diseñar landing marketing ni copiar interfaz nativa de Chatwoot. Evitar UI que presuponga permisos no implementados.

**Aceptación:** rutas sin enlaces rotos, sidebar responsive, estados de carga/vacío con textos útiles, UI consistente con brand audit, capturas a 1440/768/390px, navegación básica por teclado y sin overflow global. Lint/typecheck/build y prueba UI básica pasan.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
