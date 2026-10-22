# Etapa 11 — Dashboard verificable, monitoreo y herramientas operativas

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** hacer útil el dashboard y facilitar operar Loopchat con pocos clientes sin exposición innecesaria.

**Inspeccionar antes:** datos reales de oportunidades/mensajes/uso, pipeline, privacidad de logs y esquemas de tiempo/periodo.

**Implementar:** dashboard con conteos rastreables por tenant y periodo, conversaciones por estado, primera respuesta, oportunidades y valor, ventas cerradas, bot→humano y consumo. Filtros honestos; estados vacíos; unidades/moneda correctas. Health checks de Next/Chatwoot y colas; logs estructurados sin secretos; procesos de reconciliación de conversaciones y eventos fallidos; runbook de soporte básico. Admin plataforma ve estado de tenants/infra, no historial privado de mensajes por defecto.

**No tocar:** analytics predictivos, panel de métricas inventadas, observabilidad enterprise cara o exposición de costos definitivos de Meta si no vienen de fuentes reales.

**Aceptación:** fixtures reproducibles generan métricas calculadas y verificadas, query por tenant no filtra datos; alertas de sync fallido y estado de integración son útiles, layout carga ágil con paginación; tests de cálculos y API, verificación visual y build.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
