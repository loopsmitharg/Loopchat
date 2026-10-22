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
| "Fuera de la ventana de 24 h" | Política de Meta | Solo plantillas aprobadas (desde Chatwoot en V1) |
| Cola atrasada | Worker detenido | `docker compose … up -d worker`; los trabajos bloqueados se retoman solos al vencer el lock |

## Backups y restore

Backups **separados** y consistentes:

1. **Loopchat:** `DATABASE_URL=… STORAGE_DIR=/data/storage scripts/backup.sh /backups` (pg_dump formato custom + tar de documentos). Programar diario (cron) y copiar fuera del VPS.
2. **Chatwoot:** `docker compose exec postgres pg_dump -U postgres -Fc chatwoot > chatwoot-$(date +%F).dump` + volumen `storage_data`. Seguir la guía oficial.
3. **Claves:** `LOOPCHAT_ENCRYPTION_KEYS`, `BETTER_AUTH_SECRET` y el `.env` de Chatwoot en un gestor de secretos (sin ellas el backup de credenciales no sirve).

Restore (probarlo primero en una base temporal, **nunca** sobre producción):

```bash
createdb loopchat_restore
TARGET_DATABASE_URL=postgres://…/loopchat_restore scripts/restore.sh /backups/loopchat-db-XXXX.dump /backups/loopchat-storage-XXXX.tar.gz ./storage-restore
```

Evidencia de una prueba de restore en `docs/qa-final.md`.

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
