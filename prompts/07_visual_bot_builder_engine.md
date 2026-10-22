# Etapa 07 — Constructor visual de bots y ejecución de flujos

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** editor y runtime reales, no maqueta de nodos.

**Inspeccionar antes:** runtime bot básico, contratos de herramientas IA y persistencia de estado. Consultar API React Flow MIT.

**Implementar:** React Flow editor de nodos `inicio`, `mensaje`, `IA`, `condición`, `crear/actualizar oportunidad`, `asignar humano`, `esperar`, `fin`; panel de propiedades, conexiones tipadas, validaciones determinísticas, autoguardado con control de versiones, simulador **que nunca envía mensajes reales** y publicar versión inmutable. Persistir `flow_runs` y paso actual; interpretar versión publicada en producción con reintentos idempotentes, pausa/cancelación, timeout, guardas de bucles y handoff. Permitir bot por instrucciones como atajo sin exponer complejidad innecesaria.

**No tocar:** marketplace, ejecución arbitraria JavaScript, agentes sin límites, canvas decorativo sin ejecutor; no llamar a APIs de pago en simulador salvo opción aislada autorizada.

**Aceptación:** flujo de 2 rutas creado por tenant A, guardado/recarga/publicado, simulado y ejecutado desde evento real/fake; errores visuales para conexiones inválidas; versión publicada no cambia al editar borrador; operador humano pausa ejecución. Tests de validator, interpreter, retries y cross-tenant; UI laptop y móvil con alternativas de entrada; build verde.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
