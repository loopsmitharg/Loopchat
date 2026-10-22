# Etapa 09 — Onboarding de clientes y configuración de cuentas

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** que un cliente de Loop Smiths pueda preparar su propia empresa sin intervención técnica manual continua.

**Inspeccionar antes:** tenant/auth, capacidades de API Chatwoot, configurador IA existente, limitaciones reales de WhatsApp Cloud API.

**Implementar:** onboarding admin de plataforma crea tenant/asigna plan/invita; tenant_admin configura canal Meta guiado (IDs, permisos, token, vínculo con Chatwoot), verifica estado, errores y rotación; gestiona agente(s), invita equipo y configura bot y pipeline. Cada cliente usa su Meta Business, WhatsApp Cloud API y facturación propia; comprobar y avisar riesgos de usar línea de crédito de Loop Smiths. Guardar conexiones cifradas y configuración auditable; desconexión segura; administración Loop Smiths con impersonación deshabilitada por defecto.

**No tocar:** Embedded Signup completo si requiere app review Meta no concedida, pasarela de pagos, WhatsApp no oficial, bypass de verificación del proveedor.

**Aceptación:** dos empresas quedan configuradas con cuentas Chatwoot independientes, sin mezcla; se puede conectar/desconectar/rotar token de prueba y manejar errores; roles correctos y secretos invisibles. Proceso real Meta marcado `BLOCKED_EXTERNAL` si faltan activos/permisos y checklist inequívoco. Tests A/B y restauración de configuración, browser QA.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
