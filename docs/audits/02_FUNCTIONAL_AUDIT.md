# 02 — Auditoría funcional

**2026-11-04 · commit `ecbf4e2`**
Leyenda de estado:
- **VERIFICADO** = probado en esta auditoría con código real (tests existentes que pasan, harness nuevo o HTTP contra la app local).
- **SIMULADO** = funciona contra los simuladores de contrato de Chatwoot/Meta/IA; falta probar con el servicio real.
- **PARCIAL** = existe pero tiene un defecto o falta una parte relevante.
- **FALTA** = no existe en el código.
- **NO VERIFICADO** = no se pudo ejecutar; se indica el motivo.

Evidencia base: `npm run test` → **21 archivos / 209 tests PASS** (PostgreSQL 17 embebido, Windows); harness `tests/audit/conversations.audit.test.ts` → 50 escenarios (41 PASS / 4 PARTIAL / 5 FAIL); `tests/audit/http-tenancy.audit.mjs` → 12 chequeos HTTP (11 PASS / 1 FAIL esperable en dev); E2E Playwright (ver §7).

## 1. Empresas y usuarios

| Función | Estado | Evidencia / nota |
|---|---|---|
| Login / logout / invalidación de sesión | VERIFICADO | `auth-tenancy.test.ts`, `auth.spec.ts`; login HTTP en esta auditoría |
| Registro público | Deshabilitado por diseño | `disableSignUp: true` (`src/server/auth/index.ts`) |
| Alta de empresa (panel Loop Smiths) + invitación del admin | VERIFICADO | `auth.spec.ts` (E2E completo) |
| Invitación de usuarios por `tenant_admin`, cupo de agentes | VERIFICADO | `auth-tenancy.test.ts` |
| Roles `tenant_admin/manager/agent/viewer` + `platform_admin` | VERIFICADO | `permissions.test.ts`; HTTP T5–T7 (lectura/agente → 403; admin de empresa → 403 en plataforma) |
| Recuperación de contraseña | VERIFICADO (local) / SMTP real NO VERIFICADO | Token 30 min, revoca sesiones. En dev los mails van a la tabla `dev_mail_outbox` |
| Suspensión de usuario | VERIFICADO con defecto | Deshabilitar un miembro revoca **todas** sus sesiones, también las de otras empresas (`members.ts`, hallazgo SEC-05) |
| Separación entre empresas | VERIFICADO | Ver 03: 0 fugas en 32 sondas HTTP; tests A/B existentes |
| Suspensión de empresa | PARCIAL | Bloquea envíos/bots/altas; algunas escrituras (crear bot, rotar credenciales) no la consultan (hallazgo SEC-08) |
| Acceso de soporte auditado (impersonación) | FALTA (por diseño V1) | Deshabilitado; un platform admin puede invitarse a sí mismo (auditado) |

## 2. Contactos

| Función | Estado | Evidencia |
|---|---|---|
| Crear / editar / buscar / filtrar | VERIFICADO | `pipeline.test.ts` (contactos), `contacts.ts`, E2E móvil (ficha) |
| Normalización E.164 y detección de duplicados | VERIFICADO | "normaliza teléfono E.164, evita duplicados y aísla por tenant" |
| Vincular conversaciones y oportunidades | VERIFICADO | creación automática al primer mensaje; S26 |
| Historial / ficha unificada | VERIFICADO (UI) | `contact-detail.tsx`, E2E móvil |
| Etiquetas y campos comerciales | VERIFICADO | `lead-fields.ts`, "no pisa datos cargados por una persona" |
| Fusión manual de contactos | FALTA | No hay endpoint de merge (no exigido explícitamente en `context.md`) |

## 3. Pipelines y oportunidades

| Función | Estado | Evidencia |
|---|---|---|
| Crear pipelines, modificar/reordenar etapas | VERIFICADO | `pipeline.test.ts`; reglas: inicial abierta, una ganada, una perdida |
| Crear/mover oportunidades (drag-and-drop y selector accesible) | VERIFICADO | `pipeline.spec.ts`; concurrencia optimista (409) |
| Asignar vendedor, importe, seguimiento, tareas, notas | VERIFICADO | `pipeline.spec.ts` |
| Historial de cambios | VERIFICADO | `opportunity_history`, "historial auditable" |
| Acciones automáticas por etapa | VERIFICADO (equipos) | "etapa alcanzada → activa un bot; oportunidad cerrada → detiene el bot" |
| El bot no puede mover a etapas no autorizadas ni marcar ganada | VERIFICADO | S29/S30/S7 (harness) + `bot-module.test.ts` |
| Excepción: camino "cotización" | PARCIAL | El bot puede mover a la etapa de cotización aunque no tenga `update_stage` ni esté en `allowedStageIds` (código, hallazgo AI-12) |

## 4. Bandeja de WhatsApp

| Función | Estado | Evidencia |
|---|---|---|
| Recepción de mensajes (webhook firmado, dedupe) | SIMULADO | `chatwoot-inbox.test.ts`, S39 |
| Envío (único camino por Chatwoot, idempotente) | SIMULADO | "respuesta desde Loopchat llega a Chatwoot una sola vez" |
| Historial (leído en vivo desde Chatwoot) | SIMULADO | `thread.tsx`, `listMessages` |
| Adjuntos recibidos | SIMULADO | visualización; envío de adjuntos por agentes **FALTA** (documentado en `qa-final.md §9`) |
| Fotos de productos enviadas por el bot | SIMULADO | "foto del producto: se envía como adjunto" |
| Estados de entrega (enviado/entregado/leído/fallido) | SIMULADO | conciliación por API |
| Notas internas que nunca salen | VERIFICADO | test + E2E |
| Un único responsable; asignación | VERIFICADO | "un solo responsable…" |
| Derivación humana y pausa del bot | VERIFICADO | S8, S9, S21, tests existentes |
| Ventana de 24 h de Meta | VERIFICADO (lógica) | bloquea mensaje libre con explicación |
| Envío de plantillas fuera de ventana desde Loopchat | FALTA | Hay que usar la UI de Chatwoot (documentado). Bloquea reactivar clientes desde Loopchat |
| Tiempo real | PARCIAL | Polling con backoff (5 s / 4 s); sin websockets |
| Mensajes duplicados por reintentos de webhook | VERIFICADO | S39 |
| **Mensajes del cliente mientras el bot procesa** | **PARCIAL / defecto** | El 2º mensaje se descarta para el bot (no se re-encola). Medido: "Quiero hablar con un **asesor**" (palabra clave) fue ignorado → la conversación siguió en modo bot (S24) |

## 5. Chatbots

| Función | Estado | Evidencia |
|---|---|---|
| Bot por instrucciones (identidad, personalidad, objetivos, reglas, horarios, límites) | VERIFICADO (llegan al prompt) | `ai-profile.test.ts`, `instructions.test.ts`, S6 (regla obligatoria presente) |
| Efecto real de la personalidad en un LLM | **NO VERIFICADO** | Requiere claves reales; los tests comprueban que el texto llega al prompt, no cómo responde un modelo |
| Proveedores: OpenAI-compatible, Anthropic, Gemini | SIMULADO | `ai-step.test.ts`, `openai-quirks.test.ts` |
| Catálogo de productos (precio/stock reales, "NO INFORMADO") | VERIFICADO | S1–S4 |
| Catálogo en preguntas de seguimiento ("¿y cuánto sale?") | **FALLA** | S4b: la búsqueda usa solo el último mensaje; el precio no llega al modelo en el 2º turno |
| Conocimiento (FAQ, texto, TXT/MD/PDF textual) | VERIFICADO | `knowledge-tasks.test.ts` |
| Herramientas (allowlist) | VERIFICADO | S37 (herramienta no habilitada ignorada) |
| Detección local de insultos sin IA | VERIFICADO | S11–S13 (ES, EN, leet, separadores, repeticiones) con 0 llamadas a IA; S14 sin falsos positivos |
| Constructor visual (inicio/mensaje/IA/condición/oportunidad/humano/esperar/fin) | VERIFICADO | `flow.test.ts`, `bots.spec.ts` |
| Simulador (sin efectos) | VERIFICADO | tests + prueba manual en navegador (muestra herramientas, derivación, huella de instrucciones) |
| Versiones / publicar / restaurar / comparar | VERIFICADO | S43 + tests |
| Historial de ejecuciones con métricas | VERIFICADO | `flow_runs.metrics`, pestaña Ejecuciones |
| Validación de salida (precios/descuentos inventados) | **FALTA** | S6: un descuento inventado por el modelo se envía tal cual |
| Manejo de salida malformada | **FALLA** | F5: JSON truncado se envía crudo al cliente |

## 6. Equipos multiagente

| Función | Estado | Evidencia |
|---|---|---|
| Recepcionista → ventas/soporte; ventas ⇄ soporte | VERIFICADO | S16–S20 + `bot-teams.test.ts` |
| Un solo bot activo; respuestas tardías descartadas | VERIFICADO | S22 (no se envió la respuesta tardía), tests |
| Derivación humana del equipo | VERIFICADO | S21 |
| Bot inexistente / ciclos | VERIFICADO | S23, S25 (rechazados al publicar) + límite de saltos en runtime (tests) |
| Versiones fijadas por conversación | VERIFICADO | tests existentes |
| Efectos CRM tras toma humana | **PARCIAL** | S22: la respuesta tardía no sale, pero la tarea y la oportunidad que decidió la IA **sí se crean** después de que el vendedor tomó el control |

## 7. Suscripciones y límites

| Función | Estado | Evidencia |
|---|---|---|
| Planes editables, cambio de plan auditado | VERIFICADO | `quota-subscription.test.ts` |
| Límites en backend: números, agentes, pipelines, bots activos, IA/mes, editor | VERIFICADO | tests (incluye concurrencia) |
| Límite de almacenamiento | FALTA | Solo tope de 5 MB por archivo; no hay cuota total (no listado en los planes de `context.md`) |
| Registro de consumos (mensajes, IA con tokens) | VERIFICADO | `usage_events`; F4 muestra que los reintentos consumen cupo extra |
| Suspensión/reactivación | VERIFICADO con brechas | ver SEC-08 |
| Cobro automático | FALTA (fuera de alcance V1 por decisión) | `context.md §4.5` |
| Costos de Meta/IA a cargo del cliente | VERIFICADO en código | BYOK; no existe clave central. La verificación de la línea de crédito de Meta del cliente es manual (checkbox "facturación propia") |

## 8. UI

E2E Playwright existente (escritorio 1440 + móvil 390 + axe-core): ver resultado en `03`/`05` y `docs/audits/evidence/`. Revisión manual en navegador (modo dev local): dashboard, chatbots, detalle de bot, simulador y pipeline renderizan con datos DEMO, sin overflow horizontal a 1440 y 390; X-Frame-Options DENY activo. En modo dev las vistas tardan 5–15 s en la primera carga (compilación); no es representativo de producción.

## 9. Porcentaje funcional de la V1 (estimación con método explícito)

Se tomaron los 8 criterios de `context.md §8` y las 7 áreas de §4 como 34 capacidades verificables (tablas anteriores, excluyendo lo que `context.md` declara fuera de alcance):
- Implementadas y verificadas localmente (código real, con o sin simulador): **27/34 ≈ 79 %**.
- Con defecto o parciales: **5/34** (mensajes concurrentes, catálogo en seguimiento, salida malformada, efectos tras toma humana, suspensión de empresa).
- Faltantes: **2/34** (plantillas fuera de ventana desde Loopchat, adjuntos salientes de agentes).
- **Verificadas contra servicios reales (Meta/Chatwoot/IA): 0 %.**

Este porcentaje mide presencia y comportamiento local, no preparación para producción.
