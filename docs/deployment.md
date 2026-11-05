# Despliegue (VPS Linux)

> No se realizó ningún despliegue: requiere contratar VPS, dominio y credenciales (decisiones del usuario). Este documento deja los pasos exactos y verificables. Dimensionar con pruebas; un VPS barato no garantiza alta concurrencia.

## Topología recomendada (portable)

```
Internet ──TLS──▶ Caddy/Nginx ──▶ loopchat.tu-dominio.com  → app Next (127.0.0.1:3000) + worker
                              └─▶ chatwoot.tu-dominio.com  → Chatwoot rails (127.0.0.1:3001) + sidekiq
PostgreSQL de Loopchat (contenedor propio) · PostgreSQL + Redis de Chatwoot (contenedores propios)
```

Mínimo orientativo para pocos clientes: 1 VPS de 4 vCPU / 8 GB RAM / 80 GB SSD (Chatwoot recomienda ≥ 4 GB solo para sí). Alternativa: Chatwoot en un VPS y Loopchat en otro.

## 1. Chatwoot CE

```bash
cd infra/chatwoot
cp chatwoot.env.example .env      # completar SECRET_KEY_BASE, FRONTEND_URL, contraseñas, claves de cifrado
docker compose pull                # verificar que exista la etiqueta fijada (CHATWOOT_VERSION)
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
```

1. Crear el super admin: `docker compose run --rm rails bundle exec rails c` → seguir la guía oficial, o el asistente web inicial.
2. En `https://chatwoot.tu-dominio.com/super_admin/platform_apps` crear una **Platform App** "Loopchat" y copiar su token → `CHATWOOT_PLATFORM_TOKEN` de Loopchat.
3. Verificar en la UI de Super Admin que la versión instalada sea la fijada.

## 2. Loopchat

```bash
cp .env.example .env.production    # completar TODO (ver tabla)
docker compose -f infra/loopchat/docker-compose.yml --env-file .env.production up -d --build
docker compose -f infra/loopchat/docker-compose.yml --env-file .env.production run --rm app npm run db:migrate
docker compose -f infra/loopchat/docker-compose.yml --env-file .env.production run --rm app npm run db:seed:plans
docker compose -f infra/loopchat/docker-compose.yml --env-file .env.production run --rm \
  -e BOOTSTRAP_ADMIN_EMAIL=ops@loop-smith.com -e BOOTSTRAP_ADMIN_NAME="Loop Smiths" -e BOOTSTRAP_ADMIN_PASSWORD='***' \
  app npm run bootstrap:admin
```

| Variable (producción) | Valor |
|---|---|
| `APP_URL` | `https://loopchat.tu-dominio.com` (cookies `Secure` automáticas con https) |
| `DATABASE_URL` | la arma el compose (`LOOPCHAT_DB_PASSWORD`) |
| `BETTER_AUTH_SECRET` | 48 bytes aleatorios |
| `LOOPCHAT_ENCRYPTION_KEYS` | `k1:<32 bytes base64>` (guardar en un gestor de secretos; perderla = perder credenciales cifradas) |
| `CHATWOOT_BASE_URL` | URL interna o pública de Chatwoot |
| `CHATWOOT_PLATFORM_TOKEN` | token de la Platform App |
| `CHATWOOT_WEBHOOK_TARGET_URL` | URL que Chatwoot usa para llegar a Loopchat (p. ej. `https://loopchat.tu-dominio.com`) |
| `SMTP_URL`, `MAIL_FROM` | SMTP transaccional (obligatorio en producción para invitaciones y reset) |
| `LOOPCHAT_INLINE_WORKER` | `false` (el worker corre como servicio) |
| `LOOPCHAT_ALLOW_PRIVATE_URLS` | `false` (la app no arranca si es `true` en producción) |
| `LOOPCHAT_DEMO_MODE` | `false` |
| `HEALTH_TOKEN` | opcional: habilita `/api/health` detallado con header `x-health-token` |

> **Webhook Chatwoot → Loopchat (verificado contra Chatwoot v4.19 real, 2026-11-05):** Chatwoot valida el destino de los
> webhooks con su filtro SSRF y descarta los que resuelven a IPs privadas (`Hostname … has no public ip addresses` en el log
> de Sidekiq; el webhook nunca llega). Configurar `CHATWOOT_WEBHOOK_TARGET_URL` (o `APP_URL`) con la **URL pública HTTPS** de
> Loopchat. Si se decide usar una URL interna, Chatwoot debe correr con `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true`, lo que
> también relaja su protección SSRF para otras descargas.

## 3. Proxy TLS (ejemplo Caddy)

```
loopchat.tu-dominio.com {
  # límite de cuerpo en el borde (la app además corta el stream: 512 KB webhooks/JSON, ~5 MB archivos)
  request_body {
    max_size 6MB
  }
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
  reverse_proxy 127.0.0.1:3000
}
chatwoot.tu-dominio.com {
  request_body {
    max_size 50MB
  }
  reverse_proxy 127.0.0.1:3001
}
```

Caddy no confía en el `X-Forwarded-For` que manda el cliente y agrega la IP real. En Loopchat configurar
`TRUSTED_PROXIES` con la red desde la que llega el proxy (con la app en Docker: la red bridge, p. ej. `172.16.0.0/12`):
sin eso la app no arranca en producción, porque los límites por IP no serían confiables.

## 4. Alta del primer cliente (orden)

1. `/admin` → **Nueva empresa** (plan, estado, email del admin) → se envía la invitación.
2. En la ficha de la empresa → **Aprovisionar cuenta** de Chatwoot (crea cuenta, usuario de servicio y webhook firmado).
3. El admin del cliente acepta la invitación y en **Configuración → WhatsApp** carga WABA ID, Phone Number ID y token permanente de **su** Meta Business (con medio de pago a su nombre).
4. En Meta (App del cliente → WhatsApp → Configuración) configurar el **webhook** de WhatsApp hacia Chatwoot: `https://chatwoot.tu-dominio.com/webhooks/whatsapp/<número sin +>` con el *verify token* de la bandeja (visible en la UI de Chatwoot del inbox) y suscribir `messages`.
5. **Configuración → IA**: cargar la clave del proveedor de IA del cliente y probarla. **Chatbots**: crear, simular, publicar y activar.
6. Prueba real de punta a punta (ver `docs/qa-final.md` → "Checklist de validación real").

## Actualizaciones

- Loopchat: `git pull && docker compose … up -d --build && … run --rm app npm run db:migrate`. Migraciones versionadas en `drizzle/` (hacer backup antes).
- Chatwoot: leer notas de versión, backup, cambiar `CHATWOOT_VERSION`, `docker compose pull && docker compose run --rm rails bundle exec rails db:chatwoot_prepare && docker compose up -d`. Revalidar la firma de webhooks (`docs/chatwoot-integration.md`).
