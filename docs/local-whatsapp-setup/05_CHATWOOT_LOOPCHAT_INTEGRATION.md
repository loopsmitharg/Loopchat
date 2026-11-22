# 05 — Integración Chatwoot ↔ Loopchat

| Paso | Cómo | Estado |
|---|---|---|
| Platform API | Token de la Platform App "Loopchat Local" en `.env` (`CHATWOOT_PLATFORM_TOKEN`) | REAL ✔ |
| Aprovisionamiento por empresa | `provisionChatwootAccount`: cuenta propia, usuario de servicio con token propio y webhook con secreto propio (cifrados en `chatwoot_accounts`). Todo Trabajo → cuenta de Chatwoot **6** | REAL ✔ |
| Webhook | Chatwoot → `https://<túnel-loopchat>/api/webhooks/chatwoot/<key>`; firma `X-Chatwoot-Signature` (HMAC del timestamp + cuerpo) validada por Loopchat | REAL ✔ |
| Filtro SSRF de Chatwoot | Activo; destino público HTTPS | REAL ✔ |
| Mensaje entrante → contacto + conversación en Loopchat | Bandeja **API** de Chatwoot (sin Meta) | REAL ✔ |
| Equipo de bots procesa y responde en Chatwoot | worker en ejecución + API de mensajes de Chatwoot | REAL ✔ (derivación y mensaje fijo; sin IA real) |
| Eco/conciliación del saliente | prueba R4 | REAL ✔ |
| Reintentos sin duplicar | R5/R6 (ráfaga, idempotencia) | REAL ✔ |
| Bandeja WhatsApp Cloud | requiere Meta | BLOCKED_EXTERNAL |

Las credenciales nunca se reutilizan entre empresas: cada empresa tiene su cuenta, su token de servicio y su secreto de webhook.

## Cómo repetir

```powershell
npx tsx --conditions=react-server scripts/smoke-chatwoot-todo-trabajo.ts "Quiero hablar con una persona."
```

Crea (o reutiliza) la bandeja "Prueba Loopchat (API, sin Meta)" en la cuenta de Todo Trabajo, envía un mensaje entrante real y espera la respuesta publicada en Chatwoot. Imprime si se sincronizó en Loopchat, el modo de atención, las derivaciones del equipo y la respuesta.

Prueba completa del contrato (empresas de prueba en la base de tests): `tests/audit/chatwoot-real.audit.test.ts` con `CHATWOOT_REAL_URL`, `CHATWOOT_REAL_PLATFORM_TOKEN` y `CHATWOOT_REAL_WEBHOOK_TARGET` = un túnel temporal a `http://localhost:3013`.
