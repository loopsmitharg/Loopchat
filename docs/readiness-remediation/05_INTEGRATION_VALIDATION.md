# 05 — Validación de integraciones

Leyenda: **REAL** = servicio real ejecutándose · **CONTRATO** = verificado leyendo el código fuente oficial de la versión usada · **SIMULADOR** = simulador de contrato del repo · **NO VERIFICADO**.

## Chatwoot

| Aspecto | Estado | Evidencia |
|---|---|---|
| Versión | REAL: Chatwoot CE **4.19.0** (`/api`: `queue_services ok`, `data_services ok`) en Docker local | `evidence/chatwoot-real-results.json` R0 |
| Aprovisionamiento por Platform API (cuenta, usuario de servicio, rol, webhook con secreto) | **REAL ✔** | R1 |
| Webhook firmado `X-Chatwoot-Signature: sha256=HMAC(secret, "ts.body")` aceptado por Loopchat | **REAL ✔** (además, el código de `lib/webhooks/trigger.rb` del contenedor coincide con la implementación de Loopchat) | R2 |
| Sincronización de contactos y conversaciones | **REAL ✔** | R2 |
| Respuesta automática del bot publicada por la API de mensajes | **REAL ✔** (≈ 1 s incluyendo polling) | R3 |
| Eco del webhook concilia el mensaje saliente (id de Chatwoot, estado) | **REAL ✔** | R4 |
| Mensajes consecutivos: pedido de asesor durante la IA → derivación, respuesta tardía descartada | **REAL ✔** | R5 |
| Respuesta humana desde Loopchat idempotente (doble envío misma clave → 1 copia) | **REAL ✔** | R6 |
| Plantillas: `template_params` aceptado y guardado (`additional_attributes`) con la forma `{name, language, processed_params.body}` | **REAL ✔** (bandeja API: Chatwoot no lo envía a Meta) + CONTRATO (código v4.19) | R7 |
| Carga moderada (24 mensajes, 4 empresas) | **REAL ✔** 24/24 | R9 |
| Filtro SSRF de webhooks de Chatwoot | **REAL — hallazgo**: rechaza destinos privados; requiere URL pública de Loopchat (documentado) | logs de Sidekiq |
| Bandeja WhatsApp Cloud (creación con credenciales de Meta, verificación del webhook de Meta) | NO VERIFICADO (requiere Meta) | — |
| Estados de entrega reales (sent/delivered/read/failed de WhatsApp) | SIMULADOR | `chatwoot-inbox.test.ts` |
| Reintentos y fallas de Chatwoot (500 al enviar) | SIMULADOR | engine-reliability, S42 |
| Reconciliación de eventos perdidos | SIMULADOR | `ops.test.ts` |
| Transferencias entre bots | SIMULADOR (con Chatwoot real solo el bot individual) | `bot-teams.test.ts`, S16–S21 |

Limitación del entorno: se habilitó `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` **solo en la instancia local de prueba** para que Chatwoot pudiera entregar webhooks al proceso de pruebas en la misma máquina. En producción se usa la URL pública HTTPS.

## Meta / WhatsApp Cloud API — **BLOQUEADO**

Ningún paso del checklist de `docs/qa-final.md §8` que involucra Meta pudo ejecutarse. Estado de los 12 pasos:

| Paso | Estado |
|---|---|
| 1. Chatwoot CE v4.19 con Platform App y `CHATWOOT_*` | **REAL ✔ (local)** |
| 2. Aprovisionar cuenta y verificar webhook con secreto | **REAL ✔ (local)** |
| 3. Conectar número (WABA, Phone Number ID, token) | BLOQUEADO: sin credenciales de Meta |
| 4. Webhook de Meta → Chatwoot | BLOQUEADO: requiere HTTPS público + app de Meta |
| 5. Mensaje real desde un teléfono aparece en Loopchat | BLOQUEADO (equivalente con bandeja API: REAL ✔) |
| 6. Responder desde Loopchat y ver estados en el teléfono | BLOQUEADO (envío por API de Chatwoot: REAL ✔) |
| 7. Nota interna no llega al teléfono | SIMULADOR ✔ (las notas nunca salen de Loopchat) |
| 8. IA real, pedir humano, reanudar | BLOQUEADO (IA real); con IA guionada: REAL ✔ con Chatwoot |
| 9. Flujo con espera | SIMULADOR ✔ |
| 10. Ventana de 24 h | SIMULADOR ✔ (bloqueo + plantilla desde la UI) |
| 11. Revocar clave de IA → deriva sin duplicar | SIMULADOR ✔ |
| 12. Backup y restore + `verify:restore` | **REAL ✔** (ver 06) |

**Credenciales que faltan:** app de Meta for Developers con número de prueba (WABA ID, Phone Number ID), token de usuario del sistema con `whatsapp_business_messaging` y `whatsapp_business_management`, al menos una plantilla aprobada, y un dominio con HTTPS para Chatwoot.

## Proveedores de IA — **BLOQUEADO (P0-04)**

| Adaptador | Estado |
|---|---|
| OpenAI-compatible (Chat Completions) | SIMULADOR + guionado; `finish_reason=length` → truncado; SSRF en URL configurable |
| Anthropic Messages | SIMULADOR; `stop_reason=max_tokens` → truncado (CONTRATO del formato público) |
| Gemini generateContent | SIMULADOR; `finishReason=MAX_TOKENS` → truncado |

Sin claves autorizadas no se declara verificado ningún proveedor. Prueba a ejecutar cuando existan: `docs/audits/04_CONVERSATION_TESTS.md §6` más S6 (descuento), S34/S38 (inyección), S4b (catálogo), con 3 corridas por escenario y tope de gasto.
