# 06 — Preparación operativa

## Backups (P1-11)

| Requisito | Implementación | Verificación local (2026-11-05) |
|---|---|---|
| Base de Loopchat | `pg_dump -Fc` + `pg_restore --list` (debe tener tablas) | ✔ 100 tablas en el dump |
| Base de Chatwoot | `CHATWOOT_DATABASE_URL` o `CHATWOOT_PG_DUMP_CMD` | Implementado; no ejercitado contra la base de Chatwoot (la instancia local se usó para integración) |
| Archivos | `STORAGE_DIR` y `CHATWOOT_STORAGE_DIR` (tar) | ✔ storage de Loopchat incluido |
| Cifrado | AES-256 con clave aleatoria envuelta con la clave **pública** RSA-3072 (OAEP-SHA256); la privada no vive en el servidor | ✔ descifrado solo con la privada correcta; con una clave equivocada la prueba de restore **falla** |
| Integridad | `MANIFEST.sha256` interno + SHA-256 del paquete | ✔ |
| Copia externa | `rclone copy` + `rclone check` | ✔ contra un destino local de rclone; **una copia corrupta fue detectada** (`check` falla) |
| Retención | local por días + remota por `rclone delete --min-age` | Implementado |
| Detección de errores | `set -euo pipefail`, trap con motivo, heartbeat `fail` | ✔ sin `pg_dump` → heartbeat `fail` con motivo; bugs encontrados al probar y corregidos (doble reporte, filtro de `rclone check`, `ls` sin coincidencias abortaba en silencio) |
| Ejecución diaria | `infra/ops/loopchat-backup.timer` (03:30) | Archivo provisto; no instalado (sin VPS) |
| Prueba periódica de restore | `scripts/backup-restore-test.sh` + timer semanal en host separado | ✔ restore real en base temporal: conteos `{t:2, m:6, c:5, msg:10, o:5, bv:4}`, **8/8 secretos descifrables**, base temporal eliminada, heartbeat `ok` |
| Secretos de recuperación | gestor de secretos + clave privada offline (documentado) | Procedimiento en `docs/operations.md` |

**Bloqueo:** no hay almacenamiento externo autorizado (bucket) → la copia externa real NO está verificada. No se declara una copia remota exitosa.

## Monitoreo y alertas (P1-11)

| Señal | Implementación | Verificado |
|---|---|---|
| Disponibilidad Loopchat / Chatwoot | `GET /api/health`, `GET /api` de Chatwoot, latencia | ✔ (alerta crítica con ambos caídos, resolución al volver) |
| Errores HTTP 5xx | contador por minuto en `errorResponse` | Implementado (umbral `ALERT_HTTP_5XX`) |
| Cola: pendientes, antigüedad, fallidos, leases vencidos | consultas a `jobs` | ✔ `queue_lag` detectado en test |
| Integraciones | webhooks fallidos, salientes fallidos, fallas de IA | Implementado |
| CPU, RAM, disco | `os.loadavg`, memoria libre, `statfs` | ✔ RAM/disco; **CPU en Windows siempre 0** (loadavg no existe en Windows; en Linux sí) |
| Backups / prueba de restore | heartbeats | ✔ `backup_failed`, `restore_test_missing` detectados en test |
| Consumo de IA por empresa | 80 % y 100 % del cupo mensual | Implementado |
| Canales | `ALERT_WEBHOOK_URL` (Slack/Discord/Google Chat), `ALERT_EMAIL` | ✔ alerta de prueba (`--test`) recibida por webhook local; deduplicación y aviso de resolución verificados; email: usa el SMTP existente (sin SMTP real: NO VERIFICADO) |

## CI (P1-12)

`.github/workflows/ci.yml`: `pull_request` (no `pull_request_target`), `permissions: contents: read`, sin secretos (claves de prueba generadas en el job).

| Job | Pasos | Verificación |
|---|---|---|
| checks | npm ci, lint, typecheck, unit+integración (PostgreSQL 16), harness de 50 escenarios (compuerta), build, `npm audit --audit-level=high` | Todos los comandos corridos localmente en verde |
| e2e | Playwright (1440/390 + axe) + sondas HTTP A/B con límites de login activos | Corridos localmente (27/27 y 12/12) |
| security | Gitleaks 8.21.2 verificado por checksum, Semgrep 1.95.0 | Gitleaks ✔ local; **Semgrep NO VERIFICADO** (sin binario para Windows) |

**Estado: implemented, no verificado en GitHub** (no hubo push autorizado). Un PR que rompa tests, lint, typecheck, build, auditoría de dependencias, el harness o las sondas A/B queda en rojo.

## Despliegue

- `infra/loopchat/docker-compose.yml`: web + worker + **monitor** + Postgres; `TRUSTED_PROXIES` y concurrencia del worker por variables.
- `infra/loopchat/Dockerfile`: incluye `postgresql-client`, `openssl`, `rclone`.
- `docs/deployment.md`: Caddy con `request_body max_size` y HSTS; **webhook de Chatwoot a URL pública** (hallazgo con Chatwoot real).
- No se desplegó nada (sin VPS autorizado). Producción no fue tocada.
