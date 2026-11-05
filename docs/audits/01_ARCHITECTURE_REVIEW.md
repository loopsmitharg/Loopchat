# 01 — Revisión de arquitectura

**Auditoría independiente · 2026-11-04 · commit `ecbf4e2` (v0.5)**
Método: lectura del código fuente (`src/`, `drizzle/`, `infra/`, `scripts/`, `tools/`), documentación (`context.md`, `AGENTS.md`, `docs/*`) y ejecución local. Nada de lo descrito acá se tomó de la documentación sin contrastarlo con el código.

## 1. Stack real (verificado en `package.json` y código)

| Capa | Tecnología | Observación |
|---|---|---|
| Web/API | Next.js 16.4.2 (App Router), React 19.3, TypeScript estricto, Tailwind 4 | 88 route handlers en `src/app/api/**` |
| Datos | PostgreSQL 16 + Drizzle ORM 0.45 (`pg` Pool, `DB_POOL_MAX=10`) | 46 tablas (`src/server/db/schema.ts`), 4 migraciones versionadas (`drizzle/0000–0003`) |
| Auth | Better Auth 1.7 (email+contraseña, sesiones en DB) | Registro público deshabilitado; alta solo por invitación |
| Cola/worker | Tabla `jobs` en Postgres + `FOR UPDATE SKIP LOCKED` | Worker propio `scripts/worker.ts` (proceso separado) o inline en dev |
| Mensajería | Chatwoot CE v4.19 (servicio aparte, `infra/chatwoot`) | Único camino de entrada/salida de WhatsApp |
| WhatsApp | Meta Cloud API vía bandeja WhatsApp de Chatwoot | Loopchat solo usa Graph API para **verificar** el número (lectura) |
| IA | Adaptadores propios: OpenAI-compatible, Anthropic Messages, Gemini (`src/server/ai/*`) | BYOK por empresa, claves cifradas AES-256-GCM |
| Editor visual | @xyflow/react 12 (React Flow) + intérprete propio (`src/server/flows/interpreter.ts`) | El runtime ejecuta el mismo grafo publicado |
| Tests | Vitest 5 (unit+integración contra PostgreSQL real), Playwright 1.56 + axe-core | Simuladores de contrato en `tools/` |

**No hay**: Supabase, RLS de PostgreSQL, Redis propio de Loopchat, Cloudflare Workers, websockets, CI/CD (no existe `.github/`), métricas/APM, cola externa. El contexto del encargo menciona "PostgreSQL/Supabase" y "Cloudflare Workers": **ninguno está en el código**; el aislamiento es 100 % a nivel de aplicación.

## 2. Estructura

```
src/app/(app)/*        pantallas de la empresa (dashboard, conversaciones, pipeline, contactos, tareas, chatbots, configuración)
src/app/admin/*        panel Loop Smiths (empresas, planes)
src/app/api/v1/*       API de la empresa (tenantRoute)
src/app/api/platform/* API del panel Loop Smiths (platformRoute)
src/app/api/webhooks/chatwoot/[key]  receptor público firmado
src/server/authz       contexto de tenant + permisos (assertCan)
src/server/services    lógica de negocio por dominio (≈30 servicios)
src/server/chatwoot    cliente, receptor, sincronización, reconciliación
src/server/flows       motor de bots (trigger → runtime → interpreter → ai-turn/ai-step → policy)
src/server/teams       orquestador multiagente y automatizaciones
src/server/jobs        cola en Postgres + worker
src/lib                lógica pura compartida (permisos, validación de flujos/equipos, moderación, instrucciones)
tools/chatwoot-sim, tools/ai-sim   simuladores de contrato (solo dev/test)
```

## 3. Flujos clave (respuestas a la "primera misión")

### 3.1 Cómo llega un WhatsApp a Loopchat
1. Meta → Chatwoot (bandeja WhatsApp Cloud de la empresa). Loopchat **no** recibe webhooks de Meta.
2. Chatwoot → `POST /api/webhooks/chatwoot/{webhookKey}` con `X-Chatwoot-Signature = sha256=HMAC(secret, "{ts}.{body}")`.
3. `receiveChatwootWebhook` (`src/server/chatwoot/receive.ts`): busca la empresa por `webhookKey` opaco, descifra el secreto (AAD `cwwh:{tenantId}`), valida firma y ventana de ±300 s, exige `account.id` = cuenta mapeada, deduplica por `X-Chatwoot-Delivery` o hash del cuerpo (`webhook_events.dedup_key` único) y encola `chatwoot.event`.
4. Worker → `processWebhookEvent` (`sync.ts`): upsert de conversación y contacto (único por empresa+canal+E.164), inserta el mensaje (único por `tenant_id, chatwoot_message_id`), registra consumo y, si el modo es `bot`, llama a `triggerBotForIncoming`.

### 3.2 Cómo se identifica la empresa
Por el `webhookKey` de la URL (no por datos del cuerpo) y se confirma con `account.id`. En la API de usuarios, por la cookie `loopchat_tenant` **validada contra las membresías activas** del usuario en cada request (`src/server/authz/context.ts`); un valor ajeno se ignora (verificado por HTTP, ver 03).

### 3.3 Qué bot responde
`resolveTarget` (`src/server/flows/trigger.ts`): si la conversación está fijada a un equipo activo → el `activeBotId` con la versión fijada; si no, equipo activo del número o bot individual (el específico del número tiene prioridad). Se crea un `flow_run` único por mensaje (`flow_runs_trigger_uq`).

### 3.4 Cómo se ejecuta una respuesta de IA
`executeRunJob` (`runtime.ts`) reclama la ejecución con UPDATE condicional → (equipos) detección de insultos + `routeIncoming` (palabras clave → heurística de intención → IA clasificadora) → `preAiGuards` (insultos, límite por conversación, fuera de horario, bienvenida) → `runFlow` sobre el grafo publicado → nodo IA: `runAiTurn` arma el prompt jerárquico (`src/lib/instructions/build.ts`), busca conocimiento/catálogo, reserva cupo (`reserveAiCall`, atómico), llama al proveedor con la clave de la empresa, valida la salida JSON con allowlist (`parseAiDecision`) y aplica acciones permitidas → `sendOutbound` (único camino de salida, con lock de fila sobre la conversación) → Chatwoot.

### 3.5 Cómo se transfiere
- Bot→humano: `handoffWithPolicy` (`policy.ts`) pone `attentionMode=requested`, asigna responsable/tarea según config, registra motivo; las ejecuciones activas se cancelan cuando un humano responde (`cancelActiveRuns`).
- Bot→bot (equipos): `routeIncoming` + update condicional de `activeBotId` (`orchestrator.ts`); respuestas de un bot no activo se descartan en `sendOutbound`.

### 3.6 Cómo se actualiza una oportunidad
`applyOpportunity` (`ai-turn.ts`) bajo advisory lock por contacto+pipeline: crea una por contacto y pipeline o actualiza la abierta; la etapa solo puede ser una abierta de `allowedStageIds` (nunca ganada/perdida). Humanos: `opportunities.ts` con concurrencia optimista (`version`).

### 3.7 Cómo se protege la información entre empresas
Exclusivamente en la aplicación: cada servicio llama `assertCan(ctx, …)` y filtra `tenant_id`; IDs foráneos en cuerpos se validan contra el tenant. **No hay RLS** como segunda barrera: un único `WHERE` olvidado en el futuro sería una fuga. Verificado en esta auditoría: 0 fugas en 32 sondas HTTP + revisión de las 88 rutas (ver 03).

### 3.8 Cómo se factura y limita
Planes con límites (`src/lib/plans.ts`): números, agentes, pipelines, bots activos, llamadas IA/mes, editor. Se aplican en backend dentro de transacciones (`assertResourceQuota`, `reserveAiCall` con upsert condicional). **No hay cobro automático** (por diseño, `context.md §4.5`): Loop Smiths cobra por fuera y cambia el estado de la suscripción. Meta e IA se pagan con las cuentas del cliente (BYOK); no existe clave central de IA en el código.

### 3.9 Qué pasa cuando falla una integración
- IA caída: reintentos (máx. 3 jobs con backoff 5 s/10 s) → mensaje fijo opcional → derivación a humano (verificado S41).
- Chatwoot caído al enviar: mensaje queda `failed`, el job reintenta, se reentrega con la misma clave (verificado S42) — pero **re-llama a la IA** en cada reintento (hallazgo F4).
- Chatwoot caído al leer historial: la IA responde **sin historial** silenciosamente (código, hallazgo AI-10).
- Eventos perdidos: reconciliación cada 15 min de las 2 primeras páginas de conversaciones por cuenta.

## 4. Decisiones de arquitectura y evaluación

| Decisión | Evaluación |
|---|---|
| Chatwoot como motor separado, UI propia | Correcta y bien aislada (adaptador fino `chatwoot/client.ts`). Riesgo: la validez real del contrato solo está probada contra un simulador escrito a partir del código fuente. |
| Cola en Postgres | Adecuada para el volumen inicial; evita Redis. **Pero el worker procesa de a un trabajo por vez** (`worker.ts` bucle `for`), sin concurrencia: una llamada lenta de IA bloquea a todas las empresas (medido: S48). |
| Aislamiento solo en aplicación | Implementado de forma consistente, pero sin defensa en profundidad (RLS). |
| Motor de bots propio con grafo versionado | Sólido: versiones inmutables con checksum, snapshot de configuración, fijación de versión en equipos. |
| Prompt jerárquico + allowlist de acciones | Buen diseño; los controles comerciales (etapas, ganada, herramientas) se aplican en servidor. Los controles de **contenido** (precios, descuentos) son solo de prompt. |
| Polling en vez de websockets | Simple; aceptable para pocos agentes; no medido con uso real. |

## 5. Dependencias externas y su estado

| Servicio | Estado en esta auditoría |
|---|---|
| Chatwoot CE real | **NO VERIFICADO** (solo simulador de contrato) |
| Meta WhatsApp Cloud API | **NO VERIFICADO** |
| OpenAI/Anthropic/Gemini reales | **NO VERIFICADO** (adaptadores probados contra simulador) |
| SMTP | **NO VERIFICADO** (en dev los mails van a `dev_mail_outbox`) |
| VPS/TLS/proxy | **NO VERIFICADO** (solo compose y documentación) |
