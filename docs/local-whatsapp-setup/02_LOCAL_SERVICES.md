# 02 — Servicios locales

Modo elegido: **infraestructura en Docker + Loopchat (web y worker) con Node local** (opción B). Usa los mecanismos existentes del repo (`docker-compose.dev.yml`, `infra/chatwoot/docker-compose.yml`, `npm run worker`) y facilita depurar. No se ejecuta el modo "todo en Docker" en paralelo (evita workers duplicados).

## Chatwoot CE 4.19.0 (real)

- Compose del repo (`infra/chatwoot/docker-compose.yml`, proyecto `chatwoot`): `rails`, `sidekiq`, `postgres` (pgvector pg16), `redis` (con contraseña). Volúmenes persistentes `chatwoot_postgres_data`, `chatwoot_redis_data`, `chatwoot_storage_data`.
- `infra/chatwoot/.env` (ignorado por Git) generado con secretos aleatorios (`SECRET_KEY_BASE`, contraseñas de Postgres/Redis, claves de Active Record Encryption). Valores de desarrollo: `FORCE_SSL=false` (el TLS lo termina Cloudflare), `ENABLE_ACCOUNT_SIGNUP=false`, `FRONTEND_URL` = URL pública del túnel.
- Base preparada con el procedimiento oficial: `docker compose run --rm rails bundle exec rails db:chatwoot_prepare`.
- Super admin y Platform App "Loopchat Local" creados por `rails runner`. Credenciales solo en `infra/chatwoot/.env.local-credentials` (ignorado por Git).
- **Se cerró el asistente público de instalación** (`/installation/onboarding`): con el túnel, cualquiera podía verlo. Se borró la marca `CHATWOOT_INSTALLATION_ONBOARDING` en Redis; ahora `/installation/onboarding` redirige a `/`.
- Verificado: `GET /api` → `{"version":"4.19.0","queue_services":"ok","data_services":"ok"}`; Sidekiq procesa (los webhooks reales llegan a Loopchat); los datos persisten tras `dev-stop` + `dev-start` (cuentas y conversaciones siguen ahí).

## Loopchat

- `.env` (ignorado) pasó de simuladores a **Chatwoot real**. Copia de la configuración anterior: `.env.sim-backup`. Cambios: `APP_URL` = túnel, `CHATWOOT_BASE_URL=http://localhost:3001`, `CHATWOOT_PLATFORM_TOKEN` real, `META_GRAPH_BASE_URL` oficial, `LOOPCHAT_INLINE_WORKER=false`, `LOOPCHAT_ALLOW_PRIVATE_URLS=false`, `LOOPCHAT_DEMO_MODE=false`, `TRUSTED_PROXIES=127.0.0.1/32,::1/128` (cloudflared conecta desde localhost). `CHATWOOT_WEBHOOK_TARGET_URL` sin definir → usa `APP_URL` (una variable vacía falla la validación de URL).
- Web: `next build` + `next start` con `NODE_ENV=production` (no se expone `next dev` a internet: sin overlay de errores ni endpoints de desarrollo; cookies `Secure`; validaciones de producción activas).
- Worker: `npm run worker` (un solo proceso; `dev-start` no lo duplica).
- Base: `loopchat_dev` (PostgreSQL 16 en Docker, volumen `loopchat_loopchat_dev_db`). 6/6 migraciones.
- Verificado: `/api/health` → `{"status":"ok","database":"ok"}`; login real por API; `/chatbots`, equipos y pipeline responden 200 autenticado; el worker consume jobs (procesó los webhooks de las pruebas E2E).

## Datos existentes

Las empresas DEMO (`DEMO Ferretería Norte`, `DEMO Óptica Sur`) no se modificaron. Quedaron vinculadas a cuentas del **simulador** de Chatwoot (de la configuración anterior): con Chatwoot real no envían ni reciben mensajes. Para volver a usarlas con simuladores: restaurar `.env.sim-backup`.

## Reinicio de Windows

Después de reiniciar: `powershell -ExecutionPolicy Bypass -File scripts\dev\dev-start.ps1`. Inicia Docker Desktop si hace falta, levanta todo, crea túneles nuevos y actualiza las URLs. Ver `08_NEXT_STEPS.md` por la consecuencia para Meta.
