# 01 — Auditoría de la computadora (2026-11-21)

Verificado con comandos reales en esta PC. Nada se reinstaló si ya funcionaba.

| Componente | Resultado | Comando |
|---|---|---|
| Windows | Windows 10 Home 10.0.19045 | `[Environment]::OSVersion` |
| PowerShell | 5.1.19041 | `$PSVersionTable` |
| WSL2 | Distribuciones `Ubuntu` y `docker-desktop` (v2), detenidas al inicio | `wsl --list --verbose` |
| Docker Desktop | Instalado en `%LOCALAPPDATA%\Programs\DockerDesktop` (no en Program Files). **Estaba apagado**: se inició y el daemon respondió | `docker info` |
| Docker Engine / Compose | 29.9.2 / v5.6.0 | `docker --version`, `docker compose version` |
| Recursos para Docker | 12 CPU, 7,7 GiB asignados a la VM de WSL2 (de 15,9 GB físicos) | `docker info` |
| Disco libre | C: 348 GB · D: 1.630 GB | `Get-PSDrive` |
| Node.js / npm | 24.19.0 / 11.17.0 | `node --version` |
| Git | 2.55.0 | `git --version` |
| cloudflared | **No estaba instalado.** `winget` quedó esperando una confirmación de instalador MSI (UAC) y se canceló; se descargó el binario oficial de GitHub (`cloudflare/cloudflared`, release 2026.11.1) a `%LOCALAPPDATA%\cloudflared\cloudflared.exe`. Firma Authenticode **válida, emitida a Cloudflare, Inc.** No se agregó al PATH (los scripts lo buscan ahí). | `cloudflared --version` |

## Consumo medido con todo levantado

| Contenedor | RAM |
|---|---|
| chatwoot-rails | ~527 MiB |
| chatwoot-sidekiq | ~589 MiB |
| chatwoot-postgres (pgvector pg16) | ~57 MiB |
| chatwoot-redis | ~8 MiB |
| loopchat-db (postgres 16) | ~30 MiB |

Más Next.js (`next start`) y el worker en Node local (~300–400 MB entre ambos). Total ≈ 1,6 GB: **la PC sobra**; no hizo falta tocar la memoria de WSL2 ni de Docker.

## Puertos (comprobados, no supuestos)

| Puerto | Servicio | Publicado en |
|---|---|---|
| 3000 | Loopchat (`next start`) | `127.0.0.1` |
| 3001 | Chatwoot Rails (contenedor 3000) | `127.0.0.1` |
| 5432 | PostgreSQL de Loopchat | `127.0.0.1` (antes `0.0.0.0`; se restringió en `docker-compose.dev.yml`) |
| — | PostgreSQL y Redis de Chatwoot, Sidekiq | solo red interna de Docker |

## Repositorio

- Rama `fix/loopchat-production-readiness` (contiene la remediación de seguridad; último commit previo `52fc4f6`). Cambios locales ajenos sin commitear (`.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `marketing/`): **se conservaron sin tocar**.
- Migraciones: la base de desarrollo tenía 3 de 6 aplicadas. **Se hizo backup antes** (`storage/backups/loopchat_dev-pre-todotrabajo-*.dump`, `pg_dump -Fc`) y se aplicaron las 3 pendientes con `npm run db:migrate`.
- Volúmenes existentes: solo `loopchat_loopchat_dev_db` (datos DEMO). No había contenedores ni volúmenes de Chatwoot: la instancia real de la sesión anterior ya no existía.
