# 06 — Resultados de pruebas (2026-11-21)

Leyenda: **REAL** = servicio real · **SIMULADOR** = IA simulada del simulador de Loopchat · **BLOCKED_EXTERNAL** = requiere Meta o clave de IA.

## A. Infraestructura — REAL

| Prueba | Resultado |
|---|---|
| Docker Desktop iniciado, daemon responde | PASS |
| PostgreSQL Loopchat (`/api/health` → `database: ok`) | PASS |
| Chatwoot Rails `/api` 4.19.0, `queue_services ok`, `data_services ok` | PASS |
| Redis (`PING` → `PONG`), Sidekiq arrancado y procesando webhooks | PASS |
| Next.js (`next start`) y worker activos, un solo worker | PASS |
| Persistencia: `dev-stop` (stop de contenedores, sin `-v`) + `dev-start` → empresas, bots, equipo y conversaciones de Loopchat y cuentas/conversaciones de Chatwoot intactas | PASS |
| `dev-start` ejecutado dos veces seguidas → no duplica túneles, web ni worker (`webhooks_actualizados=0` la segunda vez) | PASS |
| Monitor (`npm run monitor`) | NOT_DONE (no se dejó corriendo en local; es para el VPS) |

## B. HTTPS público — REAL (Quick Tunnels)

| Prueba | Resultado |
|---|---|
| Loopchat por HTTPS (`/api/health` 200, `/login` 200, certificado válido) | PASS |
| Chatwoot por HTTPS (`/api` 200, `/app/login` 200 sin bucles) | PASS |
| Login y cookie de sesión de Loopchat | PASS (por API) |
| Asistente de instalación de Chatwoot no accesible | PASS (corregido) |

## C. Integración Chatwoot ↔ Loopchat — REAL (sin Meta)

`tests/audit/chatwoot-real.audit.test.ts` contra la instancia local, webhook entregado por una **URL pública HTTPS** (filtro SSRF de Chatwoot activo): **10/10 PASS** — versión (R0), Platform API (R1), webhook firmado (R2), respuesta del bot (R3), eco/conciliación (R4), ráfaga con derivación sin respuesta tardía (R5), respuesta humana idempotente (R6), `template_params` (R7), sin ejecuciones colgadas (R8), 24 mensajes concurrentes en 4 empresas (R9). Evidencia: `docs/readiness-remediation/evidence/chatwoot-real-results.json`.

E2E con la app y el worker **en ejecución** y la empresa Todo Trabajo (`scripts/smoke-chatwoot-todo-trabajo.ts`):

| Mensaje (bandeja API de Chatwoot) | Resultado |
|---|---|
| "Quiero hablar con una persona." | Sincronizado; equipo fijado (v1); derivación por palabra clave; "Pide humano"; mensaje fijo de derivación publicado en Chatwoot en **2 s** |
| "¿Cuánto sale el Premium de tres meses?" | Recepción → Asesor Premium; sin IA real la llamada falla y deriva a una persona con **un** mensaje (tras ajustar `onFailure`) |
| "Hola, busco trabajo en administración en Córdoba." (después de reiniciar todo, URLs nuevas) | Recepción → Asesor de Empleos (equipo v2); webhook re-sincronizado automáticamente |

## D. Bots — SIMULADOR (motor real, IA simulada)

19/19 escenarios PASS (`scripts/simulate-todo-trabajo.ts`, detalle en `09_TODO_TRABAJO_CHATBOTS.md` y `evidence/todo-trabajo-simulations.json`).

## E. Seguridad

| Prueba | Resultado |
|---|---|
| Acceso cruzado: la administradora de Todo Trabajo pide `GET`/`PATCH` de un bot de DEMO Ferretería Norte | **404** en ambos; el bot no cambió — PASS |
| Secretos fuera de Git (`.env`, `infra/chatwoot/.env`, `.env.local-credentials`, `storage/`) | PASS (`git check-ignore`) |
| Bases y Redis no publicados a internet; Postgres de Loopchat solo en 127.0.0.1 | PASS |
| Webhooks protegidos por firma (R2) | PASS |
| SSRF de Chatwoot activo; `LOOPCHAT_ALLOW_PRIVATE_URLS=false` en la app | PASS |
| Mensajes consecutivos y reintentos sin duplicar (R5, R6, R9) | PASS |

## F. Regresión

| Comando | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npx vitest run tests/unit` | **153/153 PASS** (14 archivos) |
| `npm run lint` | Errores **solo en `.agents/skills/`** (skills de agentes instalados localmente, ignorados por Git, no son código del proyecto). `npx eslint scripts` sin errores |
| `npm run build` | PASS (el primer intento lo corta un aviso de seguridad de Next.js 16.4.2; ver `07_TROUBLESHOOTING.md`) |
| Tests de integración / E2E Playwright completos | NOT_DONE en esta sesión (no se modificó código de la app) |

## Bloqueado

Meta (bandeja WhatsApp Cloud, mensaje real desde un teléfono) e IA real: **BLOCKED_EXTERNAL**.
