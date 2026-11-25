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

### Copia externa en Cloudflare R2 sin salir de la franquicia gratuita

Franquicia (developers.cloudflare.com/r2/pricing, 2026-10): **10 GB-mes** (promedio de los picos diarios), **1 M ops Clase A** y **10 M Clase B** por mes, egress gratis, **solo clase Standard** (Infrequent Access no tiene franquicia, cobra recuperación y 30 días mínimos). Se trata como **compartida por toda la cuenta**.

Antes de subir, `backup.sh` lista el bucket (exacto) y `scripts/r2-budget.ts` consulta la API GraphQL de métricas de Cloudflare (otros buckets y operaciones del mes, toda la cuenta). Reglas:
- Tope operativo **8 GB** en la cuenta (`R2_MAX_BYTES`): si el backup no entra, **no se sube**, el backup queda en `fail` (alerta crítica) y la copia local se conserva. Nunca se borran copias válidas para hacer lugar.
- Aviso desde **6 GB** (`R2_WARN_BYTES`) y con operaciones Clase A/B al **80 %**; bloqueo al **95 %**. Los avisos van al heartbeat `r2_budget` → alerta `warning` del monitor.
- Retención externa **7 días** (`BACKUP_REMOTE_RETENTION_DAYS`): se borran solo copias vencidas o incompletas, **nunca la última copia completa** aunque esté vencida. El resumen incluye la proyección con la retención actual y cuántos días entran bajo 6 GB, para ajustarla.
- Si no puede medir (faltan `R2_ACCOUNT_ID`/`R2_ANALYTICS_TOKEN` o la API falla) **no sube** (falla cerrada).
- La copia externa exige cifrado (`BACKUP_PUBLIC_KEY`). Una copia que no pasa `rclone check` se borra y no cuenta.

Configuración (una vez, en Cloudflare): bucket **privado** y exclusivo (sin dominio público ni `r2.dev`), clase Standard; token de R2 "Object Read & Write" limitado a ese bucket para rclone; token aparte "Account Analytics: Read" para `R2_ANALYTICS_TOKEN`. La regla por defecto del bucket aborta multipart incompletos a los 7 días; no agregar reglas de expiración (podrían borrar la última copia válida). `rclone.conf`:
```ini
[r2]
type = s3
provider = Cloudflare
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
access_key_id = …
secret_access_key = …
no_check_bucket = true
```
`RCLONE_REMOTE=r2:<bucket>/prod`. Operaciones por backup diario: ~10 Clase A y ~10 Clase B por el paquete, más 1 Clase A (PutObject) y 1 Clase B (HEAD) por adjunto nuevo y 1 Clase A cada 1000 objetos del listado. Con ~150 adjuntos/día ≈ 6.000 Clase A/mes (0,6 % de la franquicia).

### Adjuntos de Chatwoot: copia incremental cifrada

Los archivos de Chatwoot (ActiveStorage en disco, volumen `chatwoot_storage_data`, montado de solo lectura en el backup) **no van en el paquete diario**: se suben a `<RCLONE_REMOTE>/media/<ruta>.enc`, cada uno **una sola vez**. Son inmutables (la ruta es la clave aleatoria del blob), así que alcanza con comparar contra el listado del bucket.
- **Qué se sube:** lo que no está en R2 o cuyo tamaño no coincide con el esperado (subida interrumpida). El tamaño cifrado es exacto: bytes de la clave RSA + `(n/16 + 1) × 16`.
- **Cifrado:** cada archivo lleva `[clave AES-256 + IV envueltos con RSA-OAEP (clave pública de backup)][AES-256-CBC]`. El servidor cifra pero no puede descifrar, igual que el paquete. Integridad: al restaurar se compara contra el MD5 que Chatwoot guardó en `active_storage_blobs.checksum`.
- **Orden:** se listan los adjuntos **después** del dump (todo lo que la base referencia ya está en disco) y se suben **antes** del paquete (un paquete en R2 implica que sus adjuntos ya están).
- **Borrados:** un adjunto que desaparece de Chatwoot se conserva en R2 `BACKUP_REMOTE_RETENTION_DAYS` desde que se detecta (estado en `$BACKUP_DIR/r2-media-orphans.json`; si se pierde, la cuenta reinicia: lado seguro) y luego se borra.
- **Tope:** los adjuntos nuevos se suman al presupuesto. Si no entran, no se sube nada (ni adjuntos ni base) y se alerta.
- **Listados:** siempre `--fast-list` / `--max-depth 1`. ActiveStorage reparte los archivos en hasta 65.536 carpetas; listar carpeta por carpeta gastaría una operación Clase A por cada una.
- Sin `RCLONE_REMOTE` (solo copia local) los adjuntos siguen yendo dentro del paquete (`chatwoot-storage.tar.gz`).

**Tamaño medido (2026-11-25, entorno local):** dump Loopchat 0,32 MB + dump Chatwoot 0,43 MB + archivos 0 → **~0,75 MB por backup cifrado**; 8 copias ≈ 6 MB. Proyección orientativa (5 empresas × 300 mensajes/día, 10 % con adjunto de ~150 KB): la base crece ~0,75 MB/día y se guarda 8 veces (~6 MB/día de bucket); los adjuntos ~22 MB/día y se guardan **una vez**. Total ≈ 28 MB/día: a 6 meses ≈ 5 GB (entra), aviso de 6 GB a los ~7 meses y tope de 8 GB a los ~9,5 meses, menos lo que ocupen otros buckets de la cuenta. Con copias completas diarias de los adjuntos, la semana dejaba de entrar a los ~2 meses. Al acercarse al aviso: bajar la retención (el resumen dice cuántos días entran), depurar adjuntos viejos en Chatwoot o pasar a un plan pago, decisión del usuario.

**Claves de backup** (una vez, en una máquina segura, no en el servidor):
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out backup-private.pem   # guardar offline + gestor de secretos
openssl pkey -in backup-private.pem -pubout -out backup-public.pem                      # al servidor: /etc/loopchat/backup-public.pem
```

**Prueba de restore** (`scripts/backup-restore-test.sh`, semanal en un host separado con la clave privada): restaura el último backup en una base temporal, corre `npm run verify:restore` (conteos + secretos descifrables), borra la base y registra el heartbeat `restore_test`. Con `RESTORE_TEST_CHATWOOT_ADMIN_URL` (servidor con pgvector) restaura también Chatwoot y sus adjuntos (bajados de forma incremental por `loopchat-restore-test.service` a `media/`), y `scripts/verify-chatwoot-media.sh` comprueba que cada archivo referenciado exista con su MD5 original e informa cuántos mensajes recuperaron sus adjuntos; un faltante o un MD5 distinto hacen fallar la prueba.

**Prueba automatizada de todo el circuito** (aislada en Docker, no toca el entorno local): `IMAGE=loopchat-app:backup-test npm run test:backup`, previa `docker build -f infra/loopchat/Dockerfile -t loopchat-app:backup-test .`. Simula R2 y la API de métricas, y cubre: subida cifrada, nada se re-sube, reparación de una subida incompleta, retención de huérfanos, sin espacio, API caída, restore de mensajes con sus archivos y detección de un adjunto corrupto. Con `CW_SCHEMA_DUMP=<dump de Chatwoot>` usa el esquema y los mensajes reales.

**Restaurar adjuntos a mano:** bajar `rclone copy <RCLONE_REMOTE>/media ./media --fast-list`, correr `restore.sh` con `RESTORE_CHATWOOT_STORAGE_DIR=./chatwoot-storage-restore RESTORE_MEDIA_DIR=./media` (además de `TARGET_CHATWOOT_DATABASE_URL`) y copiar el resultado al volumen `chatwoot_storage_data` con Chatwoot detenido, ajustando el dueño de los archivos al usuario del contenedor de Chatwoot (el restore los deja con permisos 600).

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
