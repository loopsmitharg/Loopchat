# PROMPT_SYSTEM.md — Sistema de ejecución autónoma

Este documento define un **método general reutilizable para software**, aplicado aquí a Loopchat. No contiene la especificación del negocio; leer `context.md` para eso.

## 1. Ciclo por etapa

`READ → INSPECT → PLAN (breve) → IMPLEMENT → RUN → TEST → FIX → VERIFY → CONTINUE`

- Leer las fuentes comunes y el prompt activo. Consultar solo las secciones relevantes; no reinyectar archivos completos reiteradamente.
- Inspeccionar el código y los tests existentes; detectar qué falta. Si la etapa ya fue completada, verificarla y pasar a la siguiente.
- Plan de máximo 5 puntos en trabajo normal, sin largas memorias de planificación.
- Implementar completo, correr app/tests, verificar y corregir. No delegar al usuario errores locales que el agente puede resolver.
- Actualizar `docs/execution-status.md`: número de etapa, commit/hash opcional, comandos, resultados, evidencia visual si aplica, bloqueos. Documentación corta; no generar reportes diarios redundantes.
- Siguiente etapa automáticamente solo si se cumplieron criterios y no hay fallo crítico que afecte las dependencias.

## 2. Skills preferidas (intentar una sola vez al comienzo)

Repositorio tercero: https://github.com/Leonxlnx/taste-skill. Revisar origen, contenido y permisos antes de instalar/ejecutar scripts externos; no instalar desde forks desconocidos. Ejecutar en el entorno local del agente, no en producción.

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill gpt-taste
npx skills add https://github.com/Leonxlnx/taste-skill --skill redesign-existing-projects
npx skills add https://github.com/Leonxlnx/taste-skill --skill full-output-enforcement
npx skills add https://github.com/Leonxlnx/taste-skill --skill high-end-visual-design
npx skills add https://github.com/Leonxlnx/taste-skill --skill image-to-code
```

- `gpt-taste`: guardarraíl para evitar pantallas genéricas, patrones de IA sin intención y componentes sin jerarquía.
- `redesign-existing-projects`: auditar y corregir sin destruir UI ya válida.
- `full-output-enforcement`: implementar archivos completos; no truncar ni dejar placeholders o funciones vacías.
- `high-end-visual-design`: mejorar tipo, composición, espacios, feedback/motion y acabado acorde al producto.
- `image-to-code`: analizar capturas, referencias o mockups reales antes de reproducirlas visualmente; **no inventar imágenes como obligación**.

Si ya están instaladas, no reinstalar. Si el CLI notifica que ya existen, seguir. Si una falla por incompatibilidad/red/ausencia real, registrar y seguir con guía del documento visual. Las cinco se deben intentar, sin permitir que sus preferencias contradigan la identidad. Su instalación nunca autoriza ejecutar código remoto no revisado ni dar permisos excesivos.

## 3. Stack V1, justificación y límite de infraestructura

| Capa | Selección | Por qué |
|---|---|---|
| Frontend + API de aplicación | Next.js App Router + TypeScript estricto | Un producto web SaaS con endpoints y render servidor en un mismo repo |
| Runtime | Node.js LTS soportado por la versión seleccionada de Next | Compatibilidad con dependencias, test y hosting propio |
| Paquetes | npm + `package-lock.json` | Menos herramientas y reproducible; usar lock existente si proyecto previo |
| UI | React + Tailwind CSS + CSS custom properties | Panel configurable y visual consistente |
| Editor | `@xyflow/react` (MIT) | Interacciones de nodos sin reinventar canvas; runtime propio |
| Datos | PostgreSQL en VPS, esquema y DB separados de Chatwoot | Costos iniciales bajos, FK e integridad multi-tenant |
| ORM / migraciones | Drizzle ORM + drizzle-kit, si no hay ORM existente válido | Tipado, SQL directo y migraciones controladas |
| Autenticación | Solución madura self-hosted integrada con Postgres, elegida tras inspección (preferir Auth.js si se adapta) | Evitar inventar sesiones, hash y recuperación propios |
| Motor WhatsApp | Chatwoot Community, Docker + PostgreSQL + Redis + Sidekiq | Conversaciones, agentes, medios y estados ya probados |
| Meta | WhatsApp Cloud API por tenant a través del canal Chatwoot | Facturación y número propios del cliente |
| IA | Adaptadores server-side y API keys cifradas por tenant | BYOK y proveedores intercambiables |
| Automatizaciones | Estado persistido en Postgres; Workers/Cloudflare Queues para eventos asíncronos cuando se requiera | Retries, control de concurrencia; sin duplicar lógica |
| Archivos | Almacenamiento seguro local para dev; S3-compatible/R2 para despliegue si es necesario | Evitar subir binarios al repo, desacoplar almacenamiento |
| Testing | Vitest (unit/integration), Playwright (E2E/browser); DB real en integración | Ciclos rápidos + flujos funcionales |
| Calidad | ESLint, TypeScript, formatter si ya existe, auditoría de dependencias | Consistencia sin exceso de tooling |
| Hosting | Next.js en Node/entorno compatible; Chatwoot en VPS; Workers solo lógica compatible | Rails/Sidekiq NO se pueden correr en Workers |
| Observabilidad | Logs estructurados redacted, métricas sencillas, health checks | Diagnóstico sin exponer mensajes/secretos |

Instalar dependencias **solo cuando la etapa las usa**, confirmar versión/documentación vigente y leer licencias antes de integrar. No usar n8n Community como motor embebido para SaaS autoconfigurable sin derecho comercial. No asumir que funciones de pago/Enterprise de Chatwoot están en Community.

### Topología y límites de responsabilidad

- Frontend propio y endpoints API Next.js; nunca montar la interfaz nativa de Chatwoot como producto final.
- Chatwoot recibe webhooks Meta y es dueño de mensajes y entrega. Loopchat consume webhooks/eventos Chatwoot y escribe por Account API (validación de capacidades). **No doble envío Chatwoot + Cloud API directo**.
- Loopchat mantiene dominio comercial y webhooks idempotentes; integra external IDs/Chatwoot account tenant mapping; **nunca confiar en account_id suministrado por cliente**. **Limitación importante de Platform API:** una clave solo administra cuentas/usuarios creados por esa clave o expresamente autorizados; preferir aprovisionar tenants mediante la misma Platform App y probarlo desde el inicio (fuente: https://developers.chatwoot.com/api-reference/introduction).
- Un solo Postgres físico de desarrollo puede albergar DBs separadas; backups/restores separados. Valorar managed DB más adelante; no comprometer presupuesto de USD fijo.
- Confirmar capacidades reales de API con POC temprano; si una API falta, implementar fallback mínimo y documentarlo, no forkear automáticamente.

## 4. Estrategia: MVP funcional antes que polish

Orden lógico: conexión autenticada tenant → recepción/envío por motor real (o fixtures verificables sin credenciales) → CRM persistente → bot básico con human handoff → editor ejecutable → cuotas y SaaS → UX, rendimiento y despliegue.

- Primera prioridad: **vertical slice** de un mensaje hacia oportunidad y respuesta desde interfaz propia.
- No perder semanas en dashboards perfectos antes de probar mensajes, auth y persistencia.
- Los agentes pueden trabajar en paralelo solo si sus tareas no pisan DB, auth, un mismo módulo ni contratos API.
- Asegurar una ruta demo automatizada independiente de credenciales externas, pero etiquetarla y requerir validación real para publicar producción.

## 5. Verificación local y operación (comandos orientativos)

En Windows ejecutar `npm.cmd`/`npx.cmd` en PowerShell si ExecutionPolicy bloquea scripts; no cambiar políticas de ejecución del sistema salvo necesidad explícita. En Linux/macOS usar `npm`, `npx`.

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Las instrucciones exactas deben basarse en `package.json`, entorno y scripts reales; **si no existen, crearlos cuando corresponda**. Para infraestructura usar `docker compose up -d` sobre archivos oficiales adaptados y pin de versión probada. Tests E2E: 1440, 768, 390px; logs app/worker/Chatwoot cuando aplique. Test de restores en una DB temporal, nunca prod.

## 6. Política de errores, credenciales y desbloqueos

Distinguir `BLOCKED_EXTERNAL` de error de código. No fingir éxito ante carencia de token de Meta, hosting o cuenta de IA. Continuar con stubs/fakes de integración **solo para pruebas**, aislados del runtime productivo. Dejar checklist preciso de qué acceso falta, dónde se configura, para qué test y cómo verificar. No publicar secretos en comentarios, logs, artefactos, capturas ni mensajes.

Detener acciones que pueden causar gasto, cambiar sistemas activos o borrar datos. No solicitar aprobación para tareas de código local seguras y dentro del alcance. El agente tiene permiso para modificar el código de su proyecto, ejecutar tests y corregir errores, pero no para realizar operaciones externas sensibles sin permiso.

## 7. Evidencia para declarar etapas y V1

- Informe breve por etapa: `scope implementado`, `comandos con resultado`, `captura/ruta si UI`, `riesgos pendientes`, `siguiente etapa`.
- `VERIFIED_LOCAL`: todos los tests locales pasan. `VERIFIED_REAL`: existe prueba auténtica contra Meta y IA aportadas. `SHIPPED`: verificadas seguridad, operación y flujo crítico en despliegue autorizado.
- El prompt final no añade features: corre suite, inspecciona log/TODO/FIXME, revisa responsive, seguridad, secretos, tipos, performance y scripts, build y deployment. Si faltan credenciales, entrega producto técnicamente terminado en entorno de pruebas con estado `BLOCKED_EXTERNAL`, sin falsear producción.

## 8. Referencias oficiales a consultar al ejecutar

- Chatwoot https://github.com/chatwoot/chatwoot y https://developers.chatwoot.com/self-hosted/deployment/docker
- Chatwoot API https://developers.chatwoot.com/api-reference/introduction
- WhatsApp Cloud API y políticas oficiales en documentación Meta vigente
- Next.js https://nextjs.org/docs
- React Flow https://reactflow.dev/ y https://xyflow.com/open-source
- Skills https://github.com/Leonxlnx/taste-skill
- Loop Smiths https://loop-smith.com

Estas URLs son referencias de verificación, no licencias para copiar contenido ni sustitutos de documentación propia.
