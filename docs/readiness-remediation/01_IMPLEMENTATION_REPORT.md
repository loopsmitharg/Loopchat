# 01 — Informe de implementación

**Rama:** `fix/loopchat-production-readiness` (sin fusionar a `main`) · **Base:** `ecbf4e2` · **Fecha:** 2026-11-05
**Alcance:** P0 y P1 de `docs/audits/07_ROADMAP_TO_PRODUCTION.md` + dependencias P2-04, P2-05, P2-12.
Cada corrección se hizo con el ciclo reproducir → causa raíz → corregir → test de regresión → suite completa → commit.

## A. Seguridad (commits `7af817b`, `5adde84`)

| ID | Causa raíz | Corrección |
|---|---|---|
| P1-04 SSRF | El filtro solo miraba el texto del host; no contemplaba IPv6 mapeada/NAT64/6to4 ni la resolución DNS | `src/server/http/ssrf.ts`: `BlockList` con rangos privados, loopback, link-local, CGNAT, documentación, multicast y reservados, más extracción de IPv4 embebida en IPv6. `src/server/ai/http.ts`: el cliente de IA usa `http(s).request` con `lookup` propio que valida **todas** las IPs resueltas en la conexión real (la IP validada es la usada: sin DNS rebinding), no sigue redirecciones y limita la respuesta a 5 MB. |
| P1-05 Cuerpos sin límite | `req.text()`/`req.json()`/`formData()` bufferizaban todo antes de validar | `readBodyLimited`/`readFormLimited` (`src/server/http/api.ts`): rechazan por `Content-Length` declarado y cortan el stream al superar el tope (cubre `chunked`). Webhook valida el formato de la clave antes de leer. Límite en el proxy documentado (`docs/deployment.md`). |
| P1-06 Nombre de contacto | El nombre de perfil (controlado por el cliente) entraba sin rotular al prompt de sistema y también en títulos automáticos de oportunidades | `safeContactName` (NFKC, sin controles ni símbolos estructurales, ≤ 40) y bloque rotulado como dato no confiable; títulos `Consulta de …` saneados en origen. |
| P1-10 Rate limiting | Límites de Better Auth en memoria (por proceso) e IP tomada del primer `X-Forwarded-For` | `customStorage` de Better Auth sobre la tabla `rate_limits` (compartida, sobrevive reinicios); límite **por cuenta** (10 logins / 3 resets cada 15 min); IP resuelta con `TRUSTED_PROXIES` (derecha a izquierda, igual que Better Auth) en toda la app; `TRUSTED_PROXIES` obligatorio en producción. |
| P1-14 Suspensión | Cada servicio decidía si consultar el estado de la suscripción | Política única en `tenantRoute`: con la empresa suspendida/cancelada solo lectura + acciones de resguardo explícitas (revocar IA, desconectar número, deshabilitar usuarios, revocar invitaciones). |
| P2-12 Typecheck | `tsconfig` incluía tipos generados por `next dev` (podían quedar corruptos) | `npm run typecheck` = `next typegen` + `tsconfig.typecheck.json` (fuentes + `.next/types`, sin cachés de dev). |

## B. Motor de conversaciones (commit `caddd4f`)

| ID | Causa raíz | Corrección |
|---|---|---|
| P0-02 Mensajes descartados | `trigger.ts` devolvía `busy` y el mensaje se perdía; tampoco pasaba por palabras clave ni insultos | Con una ejecución activa: (1) guardas determinísticas sin IA para **cada** mensaje (palabras de derivación del bot, insultos, derivación a persona del equipo) que derivan ya y cancelan la ejecución en curso; (2) si no aplican, el mensaje queda como **pendiente** de la conversación (`conversations.pending_bot_message`, el más nuevo gana; uno viejo fuera de orden no lo pisa) y se procesa al terminar la ejecución (también si la respuesta llega para una ejecución ocupada). Una sola ejecución activa por conversación garantizada por **índice único parcial**; la ejecución y su trabajo se crean en la misma transacción. |
| P0-03 Worker secuencial | `drainOnce` procesaba un trabajo por vez | Pool con concurrencia acotada (`WORKER_CONCURRENCY`, 8) y **equidad por empresa** en ejecuciones de bots (`WORKER_TENANT_CONCURRENCY`, 2, contando todos los workers); sondea la cola mientras hay trabajo en curso (un "quiero un asesor" no espera a una llamada lenta). |
| P2-05 Doble ejecución | Una ejecución `running` podía ser reclamada por otro worker; el lock del job vencía con lotes largos | Leases con dueño en `jobs` (`locked_by`) y en `flow_runs` (`lease_owner`, `lease_until`) con renovación (heartbeat cada 1/3 del lease); **fencing**: solo el dueño vigente completa o falla; una ejecución `running` solo se retoma si su lease venció; recuperación de ejecuciones abandonadas en el mantenimiento del worker. |
| P1-02 Reintentos | El reintento re-ejecutaba el nodo IA (otra llamada pagada) y `createTask` no era idempotente | Generación persistida en `ai_turn_results` (clave ejecución:nodo:paso) y reutilizada en el reintento; tareas con `idempotency_key` única; oportunidades ya deduplicadas por contacto+pipeline. |
| P1-03 Efectos tras toma humana | `stillInControl` se chequeaba antes de cada nodo, no antes de cada efecto | `withBotAuthority`: cada efecto comercial (oportunidad, etapa, tarea, datos comerciales, estado del bot) corre en una transacción que bloquea `FOR SHARE` la conversación y la ejecución y verifica modo bot, bot activo y ejecución vigente con su lease. La toma humana actualiza esas filas → serialización. Además, al tomar una persona se cancelan las respuestas del bot aún no enviadas (`messages.status = cancelled`) y el envío reclama el mensaje antes de llamar a Chatwoot. Pérdida de autoridad → ejecución `cancelled` sin reintentos ni derivación. |
| P2-04 Cotización | El camino de cotización movía etapas sin `update_stage` ni `allowedStageIds` | La etapa de cotización solo aplica con `update_stage` y si está entre las permitidas; mismo camino que cualquier movimiento. |
| P1-09 Consumo | Sin límite por defecto por conversación; control una vez por ejecución | Control antes de **cada** llamada (incluida la ejecución en curso), nuevo límite por contacto en 24 h (default 60), default 40 por conversación **para bots nuevos** (los existentes conservan su valor guardado: sin cambio retroactivo); alertas de consumo mensual al 80 % y 100 % en el monitor. |

Migración `drizzle/0004_reliability.sql` (aditiva; cancela duplicados activos previos antes de crear el índice único; reversión documentada en el encabezado).

## C. Respuestas de IA (commits `20fe7d5`, `3570c6f`)

| ID | Corrección |
|---|---|
| P1-01 | Los adaptadores informan truncado (`finish_reason=length`, `stop_reason=max_tokens`, `finishReason=MAX_TOKENS`). JSON roto, truncado o con estructura interna **nunca** se envía: se descarta la generación guardada, se reintenta (salvo truncado) y luego se deriva con el mensaje de falla configurado. |
| P1-07 | `src/lib/commercial-guard.ts`: valida importes (contra precios del catálogo del turno y múltiplos, o textos cargados por la empresa), descuentos/promociones (porcentajes y promesas genéricas), stock exacto y disponibilidad, confirmaciones de venta/reserva/pago y plazos de entrega. Si algo no se puede verificar, la respuesta se **retiene** y se deriva (`commercial_guard`) con un mensaje seguro. No bloquea medidas, modelos, fechas, cantidades pedidas ni porcentajes no comerciales (25 casos de falsos positivos/negativos). |
| P1-08 | El catálogo del turno incluye productos que coinciden con los mensajes recientes del cliente y los ya consultados en la conversación (máx. 5), sin enviar el catálogo completo. |

**Límite de idempotencia externo (documentado):** la API de mensajes de Chatwoot v4.19 no acepta clave de idempotencia. Loopchat marca cada envío (`content_attributes.loopchat_message_id`) y concilia por el eco del webhook; si el proceso cae justo después de que Chatwoot aceptó el mensaje y antes de registrarlo, ese mensaje queda `sending` y no se reenvía (se prefiere no duplicar).

## D. WhatsApp: plantillas (commit `2f43de7`)

P1-13: contrato verificado leyendo el código fuente de Chatwoot v4.19.0 (`routes.rb`, `MessageBuilder`, `SendOnWhatsappService`, `TemplateProcessorService`, `WhatsappCloudService`, `_inbox.json.jbuilder`): `template_params` de nivel superior con `name`, `language` y `processed_params.body` por posición; Chatwoot solo usa plantillas `APPROVED` (nombre + idioma); la lista vive en `message_templates` del inbox y se refresca con `POST /inboxes/:id/sync_templates`. Loopchat valida antes (aprobada, cantidad y formato de parámetros según reglas de Meta), usa el mismo camino de salida (idempotente, reglas de responsable, toma de control) y solo permite plantillas fuera de la ventana. UI: botón **Enviar plantilla** en la conversación, actualización desde Meta, campos, vista previa y aviso de facturación en la cuenta de Meta de la empresa. Alcance V1: parámetros de cuerpo; encabezados multimedia o botones con parámetros se muestran como no disponibles.

## E. Operación (commit `3570c6f`)

Backups cifrados con copia externa verificada, prueba de restore automatizada, monitor con alertas deduplicadas, timers systemd, servicio `monitor` en Docker Compose, CI en GitHub Actions. Detalle en `06_OPERATIONS_READINESS.md`.

## F. Pruebas nuevas

| Archivo | Casos |
|---|---|
| `tests/unit/ssrf.test.ts` | IPs reservadas y embebidas, lookup DNS, sin redirecciones |
| `tests/unit/body-limit.test.ts` | 50 MB chunked, Content-Length, multipart |
| `tests/unit/contact-name.test.ts` | saneamiento y rótulo |
| `tests/unit/commercial-guard.test.ts` | 25 casos (falsos positivos y negativos) |
| `tests/integration/auth-rate-limit.test.ts` | IP falsificada, multi-instancia/reinicio, por cuenta |
| `tests/integration/suspension-policy.test.ts` | handlers reales con sesión |
| `tests/integration/engine-reliability.test.ts` | 16: ráfagas, carrera, fuera de orden, equidad, leases, fencing, abandono, idempotencia, toma humana, cotización, límites, salida inválida, descuento, catálogo |
| `tests/integration/whatsapp-templates.test.ts` | contrato, validaciones, idempotencia, aislamiento y permisos |
| `tests/integration/ops-monitor.test.ts` | ciclo de vida de alertas y detección |
| `tests/e2e/templates.spec.ts` | flujo de plantilla en la UI |

**Fixtures ajustados (no aserciones):** el simulador de IA responde "$85.000" sin catálogo; con el validador comercial ese precio debe venir de una fuente de la empresa, así que se agregó a las instrucciones del bot de prueba. Una aserción que comparaba el texto exacto de esas instrucciones se actualizó al nuevo texto. El escenario S24c del harness se reformuló: antes medía "≤ 2 respuestas" asumiendo que se descartaban mensajes; ahora mide "una respuesta por ejecución, sin duplicados".
