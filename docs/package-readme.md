# Loopchat — Paquete de implementación autónoma

**Este ZIP es DOCUMENTACIÓN + PROMPTS. No contiene la aplicación Loopchat.**

## Inicio en Codex / Claude Code / Antigravity

1. Crear o abrir repositorio privado `loopsmitharg/loopchat` (o usar su repositorio actual; **no sobrescribir** cambios existentes).
2. Copiar los archivos de este paquete a la **raíz del repo**, conservando `prompts/`.
3. Abrir el repositorio con el agente de desarrollo.
4. Pegar el texto de `PROMPT_MASTER.md` como primer prompt de implementación.
5. El agente lee las fuentes, instala/intenta las skills, ejecuta etapas y actualiza `docs/execution-status.md` para que se pueda continuar entre sesiones.

## Responsabilidades sin duplicación

- `context.md` — qué hace la V1, flujos, seguridad, datos, roles, límites, no-goals.
- `AGENTS.md` — reglas permanentes y protección de código/seguridad.
- `PROMPT_SYSTEM.md` — stack, metodología, herramientas, skills y pruebas.
- `ASSETS_AND_ART_DIRECTION.md` — identidad visual y assets.
- `PROMPT_MASTER.md` — **único prompt** para ejecutar todo.
- `prompts/*.md` — tareas consecutivas con criterios de aceptación.

## Notas técnicas clave

- Chatwoot Community Edition se aloja **aparte** de Next.js; Rails/Redis/Sidekiq no corren dentro de Cloudflare Workers.
- Loopchat es un SaaS privado multiempresa; keys de Meta y proveedores IA pertenecen a cada empresa.
- Infraestructura inicialmente austera; no asumir precio fijo ni concurrencia ilimitada.
- El constructor visual de bots es funcionalidad de **V1**, no aspiración futura.
- La paleta histórica está documentada, pero debe contrastarse con `https://loop-smith.com` antes de cerrar tokens definitivos.
- La autonomía se limita al código local. Falta de API keys/host autoriza tests reproducibles, **no** declarar prueba real o desplegar en nombre del usuario.

## Listado de etapas

1. [`prompts/00_repo_audit_bootstrap.md`](prompts/00_repo_audit_bootstrap.md) — Auditoría de repositorio, herramientas y bootstrap.
2. [`prompts/01_design_shell_navigation.md`](prompts/01_design_shell_navigation.md) — Sistema visual y navegación funcional.
3. [`prompts/02_multitenancy_auth_database.md`](prompts/02_multitenancy_auth_database.md) — Tenants, autenticación, datos y RBAC.
4. [`prompts/03_chatwoot_poc_connector.md`](prompts/03_chatwoot_poc_connector.md) — Chatwoot aislado y contrato de integración.
5. [`prompts/04_whatsapp_inbox_human.md`](prompts/04_whatsapp_inbox_human.md) — Bandeja humana real desde Loopchat.
6. [`prompts/05_contacts_sales_pipeline.md`](prompts/05_contacts_sales_pipeline.md) — Contactos, oportunidades y pipeline.
7. [`prompts/06_ai_providers_basic_bot.md`](prompts/06_ai_providers_basic_bot.md) — IA BYOK y bot básico con transferencia humana.
8. [`prompts/07_visual_bot_builder_engine.md`](prompts/07_visual_bot_builder_engine.md) — Constructor visual de bots y ejecución de flujos.
9. [`prompts/08_knowledge_tasks_automations.md`](prompts/08_knowledge_tasks_automations.md) — Conocimiento documental, tareas y automatizaciones comerciales.
10. [`prompts/09_tenant_onboarding_settings.md`](prompts/09_tenant_onboarding_settings.md) — Onboarding de clientes y configuración de cuentas.
11. [`prompts/10_subscription_quota_admin.md`](prompts/10_subscription_quota_admin.md) — Planes, cuotas y panel SaaS.
12. [`prompts/11_metrics_dashboard_operations.md`](prompts/11_metrics_dashboard_operations.md) — Dashboard verificable, monitoreo y herramientas operativas.
13. [`prompts/12_quality_security_accessibility.md`](prompts/12_quality_security_accessibility.md) — QA integral, seguridad, responsive y performance.
14. [`prompts/13_ship_v1.md`](prompts/13_ship_v1.md) — Ship V1: build, runbook y prueba completa.

**Criterio de división:** primero infraestructura mínima y una mensajería end-to-end, después capacidades comerciales e IA, luego suscripciones/operación y por último QA y ship. Ninguna etapa reimplementa la anterior.
