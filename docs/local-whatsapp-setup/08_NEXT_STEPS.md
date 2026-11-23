# 08 — Cómo retomar y próximos pasos

## Uso diario

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-start.ps1
```

Idempotente: inicia Docker Desktop si hace falta, PostgreSQL de Loopchat, Chatwoot (Rails, Sidekiq, PostgreSQL, Redis), los dos túneles, actualiza URLs y webhooks, aplica migraciones pendientes, compila si no hay build (`-Build` fuerza recompilar después de cambiar código) y arranca web y worker. Al final muestra el estado y las URLs.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-status.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-stop.ps1
```

`dev-stop` detiene web, worker, túneles y contenedores **sin borrar volúmenes** (`-KeepDocker` deja los contenedores corriendo). Solo detiene procesos que él mismo registró (PID + nombre de proceso verificado).

Logs: `scripts\dev\dev-logs.ps1 [web|worker|chatwoot|sidekiq|tunnels]`.

## URLs temporales

Las URLs `*.trycloudflare.com` cambian cada vez que se reinician los túneles (reinicio de Windows, `dev-stop`). Loopchat y Chatwoot se re-sincronizan solos; **la URL de webhook en Meta no**: hay que actualizarla a mano (paso 5 de `04_META_CONFIGURATION.md`).

## Próxima acción (una)

Conectar el número de prueba de Meta a Todo Trabajo: Loopchat → Configuración → WhatsApp → Conectar número, y después cargar en Meta la URL `https://<túnel-chatwoot>/webhooks/whatsapp/<numero>` con el Verify Token de Chatwoot (`04_META_CONFIGURATION.md`).

## Pendientes

1. ~~**Meta**~~ HECHO (2026-11-22): números `Preubas` (+1 555…) y `pruebasnumeroReal` (+54 9 11…) conectados.
2. ~~**IA real**~~ HECHO (2026-11-22): conexión `PruebaOficial` verificada y asignada a los bots.
3. **Túnel con nombre** (opción A) para URLs estables: requiere `cloudflared tunnel login` del propietario de Cloudflare.
4. ~~**Actualizar Next.js**~~ HECHO (2026-11-23): 16.4.6. Siguiente paso: migración al VPS (`docs/migracion-vps.md`).
5. Horario de atención y canal seguro para datos sensibles de Todo Trabajo: el dossier no los define (ver `09_TODO_TRABAJO_CHATBOTS.md`, limitaciones).
