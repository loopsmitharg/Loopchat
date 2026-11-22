# 04 — Configuración de Meta (WhatsApp Cloud API)

Arquitectura: **Meta → Chatwoot** (`/webhooks/whatsapp/<numero>`) → webhook firmado → Loopchat → bot/CRM → API de Chatwoot → Meta. Meta **no** envía webhooks a Loopchat.

Estado: **preparado, pendiente de credenciales** (`BLOCKED_EXTERNAL`). No se pidió ni se guardó ningún token en el chat ni en documentos.

## Dónde va cada dato

| Dato de Meta | Dónde se ve en Meta | Dónde se carga |
|---|---|---|
| Phone Number ID | App Loopchat → WhatsApp → *Configuración de la API* (API Setup) | Loopchat → **Configuración → WhatsApp → Conectar número** (empresa Todo Trabajo) |
| WhatsApp Business Account ID | Mismo panel (debajo del número) | Mismo formulario de Loopchat |
| Número (con código de país) | Mismo panel (número de prueba o el nuevo) | Mismo formulario de Loopchat |
| Token | Temporal (24 h) en API Setup; persistente: *Configuración del negocio → Usuarios del sistema* → token con `whatsapp_business_messaging` y `whatsapp_business_management` | Mismo formulario de Loopchat (se cifra; no se muestra después) |
| App ID | App → Configuración → Básica | No hace falta en Loopchat ni en Chatwoot para la integración manual |

Loopchat verifica el número con la Graph API (solo lectura) y **crea la bandeja WhatsApp Cloud en Chatwoot** con esos datos.

## Pasos (en este orden)

1. `scripts\dev\dev-start.ps1` y anotar la URL del túnel de Chatwoot (la imprime `dev-status`).
2. En Meta, API Setup: agregar tu teléfono como destinatario de prueba (el número de prueba solo envía a números verificados).
3. Entrar a Loopchat (URL del túnel) con la administradora de Todo Trabajo (credenciales en `storage/todo-trabajo-admin.local.txt`, solo en esta PC) → Configuración → WhatsApp → Conectar número. Completar con los datos de la tabla.
4. Obtener el **Verify Token** que generó Chatwoot para esa bandeja (se muestra en tu terminal, no en el chat):

   ```powershell
   docker exec -e RAILS_ENV=production chatwoot-rails-1 bundle exec rails runner "Channel::Whatsapp.where(provider: 'whatsapp_cloud').each { |c| puts c.phone_number + ' -> verify token: ' + c.provider_config['webhook_verify_token'].to_s }"
   ```

5. En Meta → App Loopchat → WhatsApp → **Configuración** → Webhook → *Editar*:
   - **URL de devolución de llamada:** `https://<túnel-chatwoot>/webhooks/whatsapp/<numero con +código de país>` (ej. `/webhooks/whatsapp/+5491100000000`).
   - **Token de verificación:** el del paso 4.
   - *Verificar y guardar*. Luego en **Campos del webhook**, suscribir **`messages`**.
6. Enviar un WhatsApp desde tu teléfono al número de prueba. Resultado esperado: aparece en Chatwoot (cuenta de Todo Trabajo) y en Loopchat → Conversaciones, con el equipo de Todo Trabajo atendiendo (ver `09_TODO_TRABAJO_CHATBOTS.md`). Sin IA real, el especialista deriva a una persona con el mensaje fijo de derivación.
7. Responder desde Loopchat (tomar la conversación) y ver el mensaje en el teléfono.

## Advertencias

- Con Quick Tunnels la URL de Chatwoot cambia en cada reinicio: hay que repetir el paso 5. Por eso se recomienda la opción A de `03_CLOUDFLARE_TUNNELS.md` antes de usar Meta de forma continua.
- Las conversaciones iniciadas por la empresa fuera de la ventana de 24 h requieren plantillas aprobadas (Loopchat ya lo controla).
- No registrar números de terceros. Los envíos reales pueden tener costo según la política de precios de Meta.
