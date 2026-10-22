# Integración con Chatwoot CE (contrato verificado)

**Versión de referencia:** Chatwoot v4.19.0 (código fuente oficial clonado e inspeccionado el 2026-10-21). Chatwoot corre como **servicio separado** (`infra/chatwoot`); Loopchat no usa ni rebrandea su interfaz.

## Topología

```
Meta WhatsApp Cloud API ──webhook──▶ Chatwoot (/webhooks/whatsapp/<numero>) ──webhook firmado──▶ Loopchat /api/webhooks/chatwoot/<clave>
Loopchat (humano o bot) ──Application API──▶ Chatwoot ──▶ Meta  (único camino de salida; Loopchat nunca llama a Meta para enviar)
```

## Endpoints usados (verificados en `config/routes.rb` y controladores)

| Uso | Método y ruta | Notas verificadas |
|---|---|---|
| Crear cuenta del tenant | `POST /platform/api/v1/accounts` | Header `api_access_token` = token de Platform App |
| Usuario de servicio | `POST /platform/api/v1/users` | Respuesta incluye `access_token` |
| Asociar usuario | `POST /platform/api/v1/accounts/:id/account_users` `{user_id, role}` | Solo sobre cuentas creadas por la misma Platform App |
| Webhook firmado | `POST /api/v1/accounts/:id/webhooks` `{webhook:{url, subscriptions}}` | La respuesta incluye `secret` (WebhookSecretable) |
| Bandeja WhatsApp | `POST /api/v1/accounts/:id/inboxes` `{channel:{type:"whatsapp", provider:"whatsapp_cloud", phone_number, provider_config:{api_key, phone_number_id, business_account_id}}}` | Chatwoot valida credenciales con Meta al crear |
| Rotar token | `PATCH /api/v1/accounts/:id/inboxes/:inbox` `{channel:{provider_config}}` | |
| Listar conversaciones | `GET /api/v1/accounts/:id/conversations?status=all&assignee_type=all&page=N` | `data.payload`, 25 por página |
| Mensajes | `GET .../conversations/:cid/messages?before=ID` | `message_type` numérico (0 in, 1 out, 2 activity, 3 template), `created_at` UNIX, `status` |
| Enviar | `POST .../conversations/:cid/messages` `{content, message_type:"outgoing", private:false, content_attributes:{loopchat_message_id}}` | `content_attributes` vuelve en el webhook (eco) |
| Estado | `POST .../conversations/:cid/toggle_status` `{status}` | |

## Webhooks: autenticidad, deduplicación y reconciliación

- **Firma real** (`lib/webhooks/trigger.rb`): `X-Chatwoot-Timestamp: <unix>`, `X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<cuerpo>")`, `X-Chatwoot-Delivery: <uuid>` (se mantiene en reintentos de Sidekiq). Loopchat verifica la firma en tiempo constante, rechaza timestamps con desvío > 5 min y exige que `account.id` del evento coincida con la cuenta mapeada a ese tenant (403 si no).
- La URL del webhook incluye una **clave opaca por tenant** (no el id de cuenta); claves desconocidas → 404.
- **Dedupe** por `X-Chatwoot-Delivery` (o hash del cuerpo) en `webhook_events.dedup_key` + índices únicos `(tenant, chatwoot_message_id)` y `(tenant, idempotency_key)`.
- **Eco de mensajes propios:** se reconoce por `content_attributes.loopchat_message_id` y no se duplica.
- **Estado de entrega:** el webhook `message_updated` no incluye `status`; Loopchat consulta la API y solo muestra "entregado/leído" con evidencia. Errores de Meta llegan como `content_attributes.external_error`.
- **Reconciliación:** el worker encola `chatwoot.reconcile_account` cada 15 min (y bajo demanda desde el panel) para recuperar conversaciones si se perdió un evento.

## Limitaciones conocidas (Community)

- La Platform API **no administra cuentas creadas desde la UI** de Chatwoot u otra Platform App. Para esos casos existe la vinculación manual (cuenta + token de un administrador), que se verifica antes de guardar.
- Versiones de Chatwoot sin firma de webhooks no devuelven `secret`: Loopchat se niega a vincularlas (no hay modo inseguro).
- Plantillas de WhatsApp: Chatwoot las sincroniza desde Meta; en V1 Loopchat **bloquea el mensaje libre fuera de la ventana de 24 h** y explica la razón; el envío de plantillas aprobadas queda fuera de la UI de V1 (se puede hacer desde Chatwoot por el administrador).
- No se usan funciones Enterprise (Captain, SLA, etc.).

## Pruebas

- `tests/integration/chatwoot-inbox.test.ts` contra el **simulador de contrato** (`tools/chatwoot-sim`), que reproduce formatos y firma de v4.19.0. **No sustituye** la prueba contra un Chatwoot real (ver `docs/qa-final.md`, `BLOCKED_EXTERNAL`).
