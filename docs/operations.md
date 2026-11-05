# Operación de Loopchat

## Procesos

| Proceso | Comando | Función |
|---|---|---|
| web | `npm run start` | UI + API + receptor de webhooks |
| worker | `npm run worker` | Cola (eventos Chatwoot, bots, esperas, reintentos), reconciliación cada 15 min, purga diaria |
| Chatwoot | `infra/chatwoot` | rails + sidekiq + postgres + redis |

## Salud y monitoreo

- `GET /api/health` → `{status, database}` (público, sin detalles). Con `HEALTH_TOKEN` + header `x-health-token` → base, Chatwoot, cola (pendientes, fallidos 24 h, antigüedad, bloqueados).
- Panel `/admin`: estado de infraestructura, empresas, cuentas Chatwoot, números con error, consumo.
- Logs JSON por stdout (redactan tokens, claves, contenidos de mensajes y prompts). Revisar `job.failed`, `chatwoot.webhook.rejected`, `flow.fallback_handoff`, `outbound.failed`.
- Alertas sugeridas: health ≠ ok, `queue.oldest_seconds > 300`, crecimiento de `webhook_events` en `failed`.

## Incidentes frecuentes

| Síntoma | Causa probable | Acción |
|---|---|---|
| Mensajes entrantes no aparecen | Webhook de Meta→Chatwoot o Chatwoot→Loopchat caído | Ver logs de Chatwoot; en `/admin` → empresa → **Reconciliar conversaciones** |
| `chatwoot.webhook.rejected` `bad_signature` | Secreto rotado o webhook recreado a mano | Re-vincular desde el panel; no desactivar la verificación |
| Eventos en `failed` | Error de procesamiento | Corregir causa y **Reprocesar eventos fallidos** (idempotente) |
| Bot no responde y deriva | Cupo de IA agotado, proveedor caído o clave revocada | Ver **Plan y consumo** y **Configuración → IA → Probar** |
| "Fuera de la ventana de 24 h" | Política de Meta | **Enviar plantilla** desde la conversación (plantillas aprobadas de la WABA; "Actualizar" las relee desde Meta) |
| Cola atrasada | Worker detenido o empresa con IA lenta | `docker compose … up -d worker`; los trabajos con lease vencido se retoman solos; ajustar `WORKER_CONCURRENCY` / `WORKER_TENANT_CONCURRENCY` |

## Backups y restore (automatizados)

**Qué se respalda:** base de Loopchat, base de Chatwoot (`CHATWOOT_DATABASE_URL` o `CHATWOOT_PG_DUMP_CMD`), archivos de Loopchat (`STORAGE_DIR`) y de Chatwoot (`CHATWOOT_STORAGE_DIR`). Los secretos de entorno (`LOOPCHAT_ENCRYPTION_KEYS`, `BETTER_AUTH_SECRET`, `.env` de Chatwoot) van en un gestor de secretos: sin ellos un backup de credenciales no sirve.

**Cómo funciona `scripts/backup.sh`** (diario, `infra/ops/loopchat-backup.timer`):
1. `pg_dump` de cada base y verificación con `pg_restore --list` (debe tener tablas).
2. Paquete con `MANIFEST.sha256`, cifrado AES-256 con clave aleatoria envuelta con la **clave pública** RSA (`BACKUP_PUBLIC_KEY`): el servidor puede cifrar pero no descifrar.
3. Copia externa con `rclone` (`RCLONE_REMOTE`) y verificación `rclone check` contra el original; retención local (`BACKUP_RETENTION_DAYS`) y externa (`BACKUP_REMOTE_RETENTION_DAYS`).
4. Resultado registrado (`npm run ops:heartbeat`); el monitor alerta si falló o si no hay backup en 26 h.

**Claves de backup** (una vez, en una máquina segura, no en el servidor):
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out backup-private.pem   # guardar offline + gestor de secretos
openssl pkey -in backup-private.pem -pubout -out backup-public.pem                      # al servidor: /etc/loopchat/backup-public.pem
```

**Prueba de restore** (`scripts/backup-restore-test.sh`, semanal en un host separado con la clave privada): restaura el último backup en una base temporal, corre `npm run verify:restore` (conteos + secretos descifrables), borra la base y registra el heartbeat `restore_test`.

**Restore manual** (siempre primero en una base temporal; el script se niega a restaurar sobre `DATABASE_URL`):
```bash
createdb loopchat_restore
BACKUP_PRIVATE_KEY=/ruta/segura/backup-private.pem TARGET_DATABASE_URL=postgres://…/loopchat_restore RESTORE_STORAGE_DIR=./storage-restore scripts/restore.sh /var/backups/loopchat/loopchat-AAAAMMDDTHHMMSSZ.tar.enc
RESTORE_DATABASE_URL=postgres://…/loopchat_restore npm run verify:restore
```
Luego, con la aplicación detenida, apuntar `DATABASE_URL` a la base restaurada (o restaurar sobre la base vacía de producción) y copiar `storage-restore` al volumen.

**Límites conocidos:** cifrado AES-256-CBC + SHA-256 del paquete (integridad ante corrupción; para resistencia a manipulación usar un bucket con versionado/bloqueo de objetos). En Windows/Git Bash el script necesita rutas relativas; en Linux (el destino real) no.

## Monitoreo y alertas

`npm run monitor` (servicio `monitor` en `infra/loopchat/docker-compose.yml`, cada 60 s) revisa disponibilidad y latencia de Loopchat y Chatwoot, cola (pendientes y antigüedad), trabajos fallidos o con lease vencido, eventos de Chatwoot fallidos, mensajes salientes fallidos, fallas de IA, errores HTTP 5xx, CPU, memoria y disco, backups y pruebas de restore, y consumo mensual de IA por empresa (80 % y 100 %). Las alertas se deduplican (aviso al abrir, recordatorio cada `ALERT_REPEAT_HOURS`, aviso al resolver) y salen por `ALERT_WEBHOOK_URL` y/o `ALERT_EMAIL`, sin secretos ni contenido de conversaciones.

Probar los canales: `npm run monitor -- --test`. Umbrales en `.env.example` (`ALERT_*`). Con el monitor en un contenedor, CPU/memoria son las del contenedor: para el host sumar el monitoreo del proveedor del VPS.

## Retención y privacidad

- Payloads crudos de webhooks: se borran a los 30 días de procesados (el worker lo hace a diario).
- El contenido de los mensajes vive en Chatwoot; Loopchat guarda metadatos y una vista previa corta.
- Contexto de ejecuciones de bots: se minimiza al finalizar (solo intención/variables).
- Definir y publicar la política de retención/borrado propia antes de producción (no se inventan obligaciones legales).

## Rotación de claves

- **Cifrado:** agregar una nueva clave al inicio de `LOOPCHAT_ENCRYPTION_KEYS` (`k2:…,k1:…`), reiniciar; los secretos nuevos usan `k2` y los viejos siguen legibles. Re-guardar credenciales (rotar tokens desde la UI) y luego retirar `k1`.
- **Tokens de Meta / IA:** desde la UI (Rotar token / Rotar clave), auditado.
- **Sesiones:** cambiar `BETTER_AUTH_SECRET` invalida todas las sesiones.

## Soporte a clientes

Loop Smiths no puede leer conversaciones de las empresas (sin impersonación en V1). Para diagnosticar se usan: estado técnico del panel, logs redactados y la información que el cliente comparta.
