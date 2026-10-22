# Etapa 05 — Contactos, oportunidades y pipeline

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** convertir conversaciones en seguimiento comercial persistente estilo Kommo.

**Inspeccionar antes:** entidades de tenant/chat, estado de sincronización de contactos, navegación actual y migraciones.

**Implementar:** contactos por empresa normalizados, enlace contacto↔conversaciones y múltiples oportunidades, pipeline/etapas configurables, kanban arrastrable y cambio por menú accesible, detalle de oportunidad con nombre, monto/moneda, responsable, origen, notas, tareas, seguimiento, ganó/perdió, historial de cambios. Crear plantillas editables de etapas solo para tenants nuevos. Relación oportun.↔conversación, creación rápida desde bandeja.

**No tocar:** pronósticos avanzados, ERP, fórmulas financieras, IA ni importaciones de CSV complejas.

**Aceptación:** mensaje de contacto nuevo vincula ficha; oportunidad se crea y mueve, recarga mantiene estado; modificar etapa de una empresa no altera otra; ediciones concurrentes se resuelven sin pérdida silenciosa; roles insuficientes no pueden mutar; tests unidad/integración/E2E para pipeline y menú sin drag. UI responsive y build pasan.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
