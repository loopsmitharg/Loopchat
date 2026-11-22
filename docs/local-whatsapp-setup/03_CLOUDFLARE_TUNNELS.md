# 03 — Cloudflare Tunnel

## Modalidad usada: B — Quick Tunnels (temporales)

La opción A (túnel con nombre y hostnames estables) requiere `cloudflared tunnel login` con la cuenta de Cloudflare del dominio y crear registros DNS. No existe `~/.cloudflared/cert.pem` en esta PC y **no se tocó el DNS de `loop-smith.com`**. Se usaron dos Quick Tunnels:

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000 --logfile storage\tunnels\loopchat.log
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3001 --logfile storage\tunnels\chatwoot.log
```

`scripts/dev/dev-start.ps1` los inicia (si no están vivos), lee las URLs `https://*.trycloudflare.com` del log y:

1. Actualiza `APP_URL` en `.env` y reinicia la web si cambió.
2. Actualiza `FRONTEND_URL` en `infra/chatwoot/.env` y recrea `rails`/`sidekiq`.
3. Reescribe el host de los webhooks de Chatwoot que apuntan a `/api/webhooks/chatwoot/<key>` (mismo secreto HMAC; solo cambia el host).

**Las URLs cambian en cada reinicio de los túneles.** No son infraestructura de producción.

## Qué queda expuesto

| Expuesto por túnel | No expuesto |
|---|---|
| Loopchat web (login, app, `/api/webhooks/chatwoot/<key>` con firma HMAC + timestamp) | PostgreSQL (ambos), Redis, Sidekiq (sin puerto), API de Docker, `.env`, repo |
| Chatwoot web (login, `/super_admin` con autenticación, `/webhooks/whatsapp/<numero>` para Meta) | Asistente de instalación (cerrado) |

Verificado por HTTPS público (certificado válido de Cloudflare, `ssl_verify_result=0`): `/api/health` 200, `/login` 200 sin bucles, Chatwoot `/api` 200 y `/app/login` 200. Cabeceras de Loopchat: `x-frame-options: DENY`, `x-content-type-options: nosniff`. Login y cookie de sesión funcionan (`POST /api/auth/sign-in/email` 200).

## Filtro SSRF de Chatwoot

Se mantiene activo: **no** se usó `SAFE_FETCH_ALLOW_PRIVATE_NETWORK`. Chatwoot entrega los webhooks a la URL pública HTTPS de Loopchat (ida y vuelta por Cloudflare). Comprobado con la prueba real R2 (ver `06_TEST_RESULTS.md`).

## Opción A (recomendada antes de conectar Meta en serio)

Requiere acción del propietario de la cuenta de Cloudflare:

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel login
```

Luego (propuesta, no ejecutada): `cloudflared tunnel create loopchat-dev`, `cloudflared tunnel route dns loopchat-dev loopchat-dev.loop-smith.com` y `... chatwoot-dev.loop-smith.com`, y un `config.yml` con dos `ingress`. Antes de crear los registros, revisar en el panel que esos subdominios no existan; no tocar MX/SPF/DKIM ni otros registros. Con hostnames estables, la URL del webhook de Meta no cambia en cada reinicio.
