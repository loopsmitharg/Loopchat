# Estado de ejecución — Loopchat V1

**Última actualización:** 2026-10-21 · **Agente:** implementación autónoma (Claude) · **Entorno de verificación:** Linux (Node 22, PostgreSQL 16, Chromium 1194), sin acceso a Docker Hub, Meta ni proveedores de IA reales.

Leyenda: `IMPLEMENTED` código completo · `VERIFIED_LOCAL` pruebas locales automatizadas pasan · `VERIFIED_REAL` probado contra servicios reales · `BLOCKED_EXTERNAL` depende de acceso externo · `NOT_DONE` no realizado.

## Resumen

| Etapa | Estado | Bloqueo externo |
|---|---|---|
| 00 Auditoría y bootstrap | VERIFIED_LOCAL | Skills de terceros inexistentes (registrado) |
| 01 Sistema visual y navegación | VERIFIED_LOCAL | — |
| 02 Tenants, auth, datos, RBAC | VERIFIED_LOCAL | SMTP real (emails van a `dev_mail_outbox` en dev) |
| 03 Chatwoot aislado y contrato | VERIFIED_LOCAL (contra simulador de contrato v4.19) | **BLOCKED_EXTERNAL**: Chatwoot real (Docker Hub bloqueado en este entorno) |
| 04 Bandeja humana | VERIFIED_LOCAL | **BLOCKED_EXTERNAL**: Meta + Chatwoot reales |
| 05 Contactos y pipeline | VERIFIED_LOCAL | — |
| 06 IA BYOK y bot básico | VERIFIED_LOCAL (simulador de proveedores) | **BLOCKED_EXTERNAL**: claves reales de OpenAI/Anthropic/Gemini |
| 07 Constructor visual y runtime | VERIFIED_LOCAL | — |
| 08 Conocimiento, tareas | VERIFIED_LOCAL | — |
| 09 Onboarding y configuración | VERIFIED_LOCAL | **BLOCKED_EXTERNAL**: activos Meta del cliente |
| 10 Planes, cuotas, panel SaaS | VERIFIED_LOCAL | — |
| 11 Dashboard y operaciones | VERIFIED_LOCAL | — |
| 12 QA, seguridad, responsive | VERIFIED_LOCAL | Pruebas reales listadas en `qa-final.md` |
| 13 Ship V1 | **VERIFIED_LOCAL / BLOCKED_EXTERNAL** (no `SHIPPED`) | Despliegue y validación real requieren VPS, dominio, Meta y claves IA |

## Mejoras del módulo de chatbots (2026-10-21, tarde)

Detalle técnico en `docs/bot-module.md` y `docs/insult-detection.md`. Migración nueva: `drizzle/0001_bot_module.sql` (aditiva; se aplica sola con `npm run db:migrate`, incluido en `iniciar-demo.cmd`).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Detección de insultos y derivación sin IA | VERIFIED_LOCAL | `tests/unit/insults.test.ts` (57 casos: 6 idiomas, evasiones, falsos positivos); integración: 0 llamadas al proveedor, `requested`, responsable, tarea, motivo `insult_detection`; captura `sim-insult-1440.jpg`, `inbox-requested-1440.jpg` |
| 2 · Catálogo de productos | VERIFIED_LOCAL | CRUD, archivo, filtros, foto con firma real y acceso por empresa, asociación versionada, precio/stock en vivo sin republicar, el prompt marca “NO INFORMADO”; foto enviada como adjunto (simulador de contrato). Real: **BLOCKED_EXTERNAL** (Chatwoot/Meta) |
| 3 · Control humano y permisos | VERIFIED_LOCAL | Estado “Pide humano”, toma de conversación, sin respuestas tardías, reactivación manual o regla “al resolver”; etapas permitidas (nunca ganada), responsable y vencimiento máximo de tareas, bloqueos registrados |
| 4 · Personalidad, horarios, memoria, objetivos | VERIFIED_LOCAL | Estilo en el prompt, bienvenida única, fuera de horario (avisar/derivar), máximo de consultas sin resolver, memoria acotada, datos comerciales validados que no pisan datos humanos |
| 5 · Simulador, versiones, ejecuciones | VERIFIED_LOCAL | Snapshot de configuración por versión, “Recuperar como borrador”, aviso de cambios sin publicar, métricas por ejecución, simulador con casos y resumen (IA llamada, herramientas, bloqueos) sin efectos |

Corrida completa tras los cambios: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 17 archivos / 167 tests · `npm run test:e2e` ✅ 21/21 (incluye `bot-module.spec.ts`, axe sin violaciones graves en las 8 secciones, móvil 390 sin overflow) · `npm run build` ✅ · capturas 1440/768/390 sin overflow horizontal.

Errores encontrados y corregidos: `PATCH` parcial de bot reiniciaba herramientas/palabras clave (defaults de Zod 4 en `.partial()`) → esquemas de parche explícitos + test; comparación de versiones dependía del orden de claves de jsonb → JSON canónico; overflow de la tabla del simulador en 390 px → contenedor con scroll; checkbox de asociación sin estado optimista → corregido; `SkeletonRows` con `aria-label` sin rol → `role="status"`.

## Personalidad, objetivos y reglas de IA (2026-10-22)

Detalle en `docs/ai-personality.md`. Migración nueva: `drizzle/0003_ai_profile.sql` (aditiva; se aplica sola al iniciar la demo).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Auditoría y modelo de herencia | VERIFIED_LOCAL | Jerarquía plataforma → obligatorias → empresa → equipo → bot → datos (`src/lib/instructions/build.ts`) |
| 2 · Identidad, objetivos y reglas de empresa | VERIFIED_LOCAL | Configuración → Identidad y objetivos de IA; permisos (obligatorias solo administradores); aislamiento por empresa |
| 3 · Personalidad y objetivos por bot | VERIFIED_LOCAL | Selectores visuales, vista previa, plantillas predefinidas y propias, rol Posventa |
| 4 · Herramientas, conocimiento, pipeline, transferencias, operación | VERIFIED_LOCAL | Conocimiento restringido por fuentes, derivaciones determinísticas (alto valor, error de acción, límite de uso), parámetros del modelo con compatibilidad real, mensaje de transición opcional en equipos |
| 5 · Motor de instrucciones efectivas | VERIFIED_LOCAL | "Instrucciones efectivas", resolución de conflictos, huella registrada por ejecución |
| 6 · Plantillas y asistente de 8 pasos | VERIFIED_LOCAL | `/chatbots/nuevo` |
| 7 · Simulador, versiones y ejecuciones | VERIFIED_LOCAL | Escenarios nuevos, comparación con una versión, "Ver qué cambió", indicadores por bot |
| 8 · Pruebas y calidad | VERIFIED_LOCAL | Ver abajo. Real (IA del cliente): **BLOCKED_EXTERNAL** para evaluar el tono generado |

Corrida: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 21 archivos / 209 tests (nuevos: `instructions.test.ts`, `ai-profile.test.ts`) · `npm run test:e2e` ✅ 26/26 + recorrida visual sin errores de consola ni overflow a 1440 y 390 · `npm run build` ✅.

Errores encontrados y corregidos: claves React duplicadas en los selectores (opción "sin definir" vs. valor "none") detectadas por la recorrida de consola; selectores de prueba ambiguos; una regla común que pasaba a obligatoria se repetía en el prompt → se deduplica.

## Equipos de chatbots integrados con pipelines (2026-10-21, noche)

Detalle técnico en `docs/bot-teams.md`. Migración nueva: `drizzle/0002_bot_teams.sql` (aditiva; se aplica sola al iniciar la demo).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Arquitectura (roles, equipos, versiones, derivaciones, bot activo) | VERIFIED_LOCAL | Esquema + migración 0002; bots existentes quedan `custom` sin cambios de comportamiento ni "cambios sin publicar" |
| 2 · Orquestación (derivación sin IA primero, un bot activo, bucles, no disponibles, duplicados, respuestas tardías) | VERIFIED_LOCAL | `tests/unit/team-route.test.ts`; `tests/integration/bot-teams.test.ts` |
| 3 · Pipelines (pipeline por bot, oportunidad por contacto+pipeline, etapas autorizadas, recepcionista sin oportunidades, automatizaciones) | VERIFIED_LOCAL | Integración: pipeline de soporte vs. principal, etapa no autorizada bloqueada, etapa alcanzada → activa bot, cierre → detiene bot |
| 4 · Configuración, plantillas por rol, asistente de 8 pasos, editor visual | VERIFIED_LOCAL | `tests/e2e/bot-teams.spec.ts` (axe sin violaciones graves, sin overflow) |
| 5 · Simulador multiagente y versiones de equipo | VERIFIED_LOCAL | Simulación sin cambios en CRM ni Chatwoot; conversación en curso conserva su versión; resolver libera la fijación |
| 6 · Validación completa | VERIFIED_LOCAL | Ver corrida abajo. Real (Chatwoot/Meta/IA): **BLOCKED_EXTERNAL** |

Corrida tras los cambios: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 19 archivos / 197 tests (incluye 19 de integración de equipos y 11 unitarios) · `npm run test:e2e` ✅ 22/22 (nuevo `bot-teams.spec.ts`; `bots.spec.ts` adaptado al selector "Tipo de atención") · `npm run build` ✅ · capturas del editor y del simulador a 1440 y 390 sin overflow.

Errores encontrados y corregidos: la creación automática de oportunidades al primer mensaje convertía reclamos en ventas con un equipo activo → se omite con equipo activo; la etapa elegida por la IA al crear la oportunidad se descartaba (solo se aceptaba con oportunidad existente) → se acepta dentro de las etapas permitidas; un reintento después de una derivación podía responder con el bot anterior → la ejecución sigue al bot activo de la conversación; el cupo de bots contaba dos veces un bot activo también en un equipo → cada bot cuenta una vez; señales de intención duplicadas.

## Comandos y resultados (corrida completa V1, 2026-10-21)

| Comando | Resultado |
|---|---|
| `npm run lint` | ✅ 0 errores / 0 advertencias |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ 13 archivos, 83 tests (PostgreSQL real + simuladores) |
| `npm run test:e2e` | ✅ 18/18 (escritorio 1440, móvil 390, axe-core) |
| `npm run build` | ✅ |
| backup → restore → `npm run verify:restore` | ✅ conteos idénticos, 8/8 secretos descifrables |
| `node scripts/capture-evidence.mjs` | ✅ 20 capturas en `docs/evidence/`, sin overflow horizontal |

Errores encontrados y corregidos durante la verificación (no quedan abiertos): subconsultas correlacionadas con columnas no calificadas (contadores incorrectos) → corregido + test `aggregates`; columnas `started_at`/`received_at` mal mapeadas → corregido + test `ops`; reintento de evento entrante no re-disparaba el bot → corregido (disparo idempotente); toasts ocultos detrás de modales → top layer; envío del login antes de hidratar → formulario `post` + bloqueo hasta hidratar; overflow en editor móvil → corregido.

## Detalle por etapa

### 00 — Auditoría y bootstrap
- Repo inicial: solo documentación, sin commits. Bootstrap con `create-next-app@16.4.2` (TypeScript estricto, Tailwind 4, ESLint, npm + lockfile). `AGENTS.md` del proyecto protegido (`agentRules: false`).
- Scripts: `dev, build, start, lint, typecheck, test, test:unit, test:integration, test:e2e, db:*, worker, sim:*, bootstrap:admin, verify:restore`.
- `.env.example` exhaustivo sin secretos; `.gitignore` excluye `.env*` (salvo el ejemplo), `storage`, reportes.
- **Skills:** se revisó el origen (github.com/Leonxlnx/taste-skill, MIT, commit 6010f91 del 2026-10-20). Los 5 nombres pedidos (`gpt-taste`, `redesign-existing-projects`, `full-output-enforcement`, `high-end-visual-design`, `image-to-code`) **no existen**; `npx skills add` respondió que solo está `design-taste-frontend`. No se instaló ni ejecutó código de terceros; se usó su guía para pantallas de app como referencia de lectura.
- **Brand audit verificado** en el sitio publicado → `docs/brand-audit.md`.

### 01 — Sistema visual y navegación
- Tokens semánticos en `globals.css` (marca lima/esmeralda real, Inter + Space Grotesk self-hosted), componentes (botón, campos con label/error, badge, avatar, panel, modal `<dialog>`, toast en top layer, estados vacío/error/sin permiso/offline/skeleton).
- Shell: sidebar estrecha + topbar con empresa activa, selector de empresa (validado en servidor), menú de cuenta; drawer en móvil; "Saltar al contenido"; foco visible; `prefers-reduced-motion`.
- Vista `/demo` (solo con `LOOPCHAT_DEMO_MODE=true`) rotulada **DEMO**, desconectada del backend.

### 02 — Multiempresa, auth, datos, RBAC
- PostgreSQL propio + Drizzle (`drizzle/0000_init.sql`, migración versionada). Entidades del modelo conceptual de `context.md` §6.
- Better Auth: email+contraseña (mín. 10), sesiones en DB, reset por email (30 min) con revocación de sesiones, alta solo por invitación (registro público deshabilitado), cookies `Secure` con https.
- Invitaciones con token aleatorio (se guarda solo el hash), 7 días, un solo uso (claim atómico). Cupo de usuarios del plan.
- Contexto de tenant validado contra membresías en cada request; IDs ajenos → 404. Matriz en `docs/permissions-matrix.md`.
- Cifrado AES-256-GCM con AAD por tenant y rotación de claves.
- Tests: `auth-tenancy.test.ts`, `permissions.test.ts`, `vault.test.ts`.

### 03 — Chatwoot
- Código fuente oficial v4.19.0 inspeccionado: rutas, payloads y **firma HMAC real** (`X-Chatwoot-Signature`, `X-Chatwoot-Timestamp`, `X-Chatwoot-Delivery`). Ver `docs/chatwoot-integration.md`.
- Aprovisionamiento por Platform API (cuenta + usuario de servicio + webhook firmado) y vinculación manual verificada.
- Receptor idempotente (dedupe por entrega y por id de mensaje), validación de cuenta cruzada, cola, reconciliación programada.
- `infra/chatwoot/docker-compose.yml` con versión fijada y DB separada.
- Simulador de contrato (`tools/chatwoot-sim`) para pruebas sin Docker/Meta. **No se afirma integración real probada.**

### 04 — Bandeja humana
- Lista paginada con filtros (mías/sin asignar/todas, estado, modo, búsqueda), hilo leído en vivo desde Chatwoot, adjuntos, estados de entrega con evidencia (conciliación por API), reintento sin duplicados, notas internas (solo Loopchat), un único responsable, cambio de estado, pausa/reanudación del bot, ventana de 24 h con bloqueo explicado, polling con backoff y detección offline.
- Tests: `chatwoot-inbox.test.ts` (10), E2E `inbox.spec.ts`, `mobile.spec.ts`.

### 05 — Contactos y pipeline
- Contactos únicos por (empresa, número de canal, E.164); ficha unificada; múltiples oportunidades.
- Pipelines y etapas configurables (reglas: inicial abierta, una ganada, una perdida), plantilla inicial editable, Kanban con drag-and-drop (dnd-kit) + selector "Mover a" accesible, detalle con importe/moneda/responsable/seguimiento/tareas/notas/historial, concurrencia optimista (409 sin pérdida silenciosa), creación rápida desde la bandeja, auto-oportunidad para contactos nuevos (configurable).
- Tests: `pipeline.test.ts`, `aggregates.test.ts`, E2E `pipeline.spec.ts`.

### 06 — IA BYOK y bot básico
- Adaptadores: OpenAI-compatible (Chat Completions), **Anthropic Messages** y **Gemini** nativos; claves cifradas por tenant, nunca devueltas; prueba de conexión; rotación/revocación; SSRF en URL base.
- Bot por instrucciones (compilado a grafo), allowlist de herramientas (clasificar, conocimiento, derivar, oportunidad, etapa, tarea), palabras de derivación, trazabilidad (bot/versión/ejecución en cada mensaje), logs redactados, reintentos acotados y derivación a humano ante falla/timeout/cupo, sin respuestas concurrentes (lock de fila + cancelación de ejecuciones al tomar control).
- Tests: `bots.test.ts` (13), `ai-step.test.ts`.

### 07 — Constructor visual
- React Flow (MIT) con nodos inicio/mensaje/IA/condición/oportunidad/asignar humano/esperar/fin, panel de propiedades, conexiones tipadas, validación determinística en vivo, autoguardado con control de revisión, vista "Lista" como alternativa sin arrastre (teclado/móvil), publicación de versiones inmutables con checksum, simulador que nunca envía mensajes (IA simulada por defecto; real opcional y explícita).
- Runtime: `flow_runs` + pasos persistidos, esperas durables con timeout, reintentos desde el último paso, guarda de pasos máximos, cancelación al pasar a humano.
- Tests: `flow.test.ts`, `bots.test.ts` (flujo de 2 rutas, borrador vs. publicado, pausa), E2E `bots.spec.ts`.

### 08 — Conocimiento y tareas
- FAQ, texto, archivos TXT/MD/PDF (≤ 5 MB, extensión + verificación de contenido, PDF sin texto → falla explícita, sin OCR), almacenamiento segregado por tenant, full-text en español acotado al tenant, eliminación.
- Tareas con responsable/vencimiento/vínculo a contacto u oportunidad, creadas también por el bot.
- Tests: `knowledge-tasks.test.ts`.
- Horario de atención por empresa (Configuración → Empresa) disponible en flujos como variable `horario` (`abierto`/`cerrado`). Exportación CSV de contactos y oportunidades (admins, auditada).

### 09 — Onboarding y configuración
- Panel Loop Smiths: alta de empresa con plan e invitación, aprovisionamiento Chatwoot, invitar usuarios. Configuración guiada de WhatsApp (WABA, Phone Number ID, token, confirmación de facturación propia), verificación de solo lectura en Graph API, vínculo con bandeja Chatwoot, rotación, desconexión segura. Equipo/roles, IA, pipeline, conocimiento, empresa, auditoría. Impersonación deshabilitada.

### 10 — Planes y cuotas
- Starter/Growth/Pro editables, estados de suscripción, cambio inmediato y auditado, cuotas en backend y worker (atómicas e idempotentes), suspensión = solo lectura, consumo visible.
- Tests: `quota-subscription.test.ts` (concurrencia incluida).

### 11 — Dashboard y operación
- Métricas trazables por tenant y período con cobertura declarada; pendientes accionables; health checks; logs estructurados redactados; reconciliación y reprocesamiento; retención; runbook (`docs/operations.md`).

### 12 — QA integral
- Ver `docs/qa-final.md`.

### 13 — Ship
- Ver `docs/qa-final.md` y `docs/deployment.md`. Estado: **no SHIPPED** (falta despliegue autorizado y pruebas reales).
