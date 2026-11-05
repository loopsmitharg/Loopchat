# 00 — Registro de progreso (remediación P0/P1)

Registro persistente para retomar el trabajo en otra sesión sin repetir la auditoría.
Rama: `fix/loopchat-production-readiness` · base: `ecbf4e2` (v0.5) · inicio: 2026-11-04.

Estados: `pending` · `in_progress` · `implemented` (código listo, sin prueba suficiente) · `verified` (probado localmente con código real; se indica si contra simulador) · `blocked` (dependencia externa).

| ID | Estado | Archivos principales | Commit | Pruebas / evidencia | Dependencias / bloqueos |
|---|---|---|---|---|---|
| P0-01 Meta/Chatwoot real | **blocked** — Chatwoot real ✔ (10/10, local), Meta ✘ | `tests/audit/chatwoot-real.audit.test.ts`, docs de webhook | 4ee1697 | `evidence/chatwoot-real-results.json`; pasos 1, 2 y 12 del checklist REAL | Número de prueba de Meta (WABA + token + plantilla aprobada) y servidor con Chatwoot accesible por HTTPS |
| P0-02 Mensajes consecutivos | verified (local, simulador Chatwoot) | `src/server/flows/trigger.ts`, `runtime.ts`, `policy.ts`, `outbound.ts`, migración 0004 | caddd4f | `tests/integration/engine-reliability.test.ts` (4 casos de ráfaga), harness S24/S24b/S24c | — |
| P0-03 Worker concurrente | verified (local) | `src/server/jobs/worker.ts`, `queue.ts` | caddd4f | engine-reliability "empresa B no espera", harness S48, S44-S47 (40 conv: 14,2 s → 2,8 s) | Prueba de carga con Chatwoot real: pendiente |
| P0-04 IA real | **blocked** | — | — | Adaptadores probados contra simulador + truncado por `finish_reason/stop_reason/finishReason` | Claves de prueba con tope de gasto (OpenAI-compatible, Anthropic, Gemini) |
| P1-01 Salida malformada | verified | `ai-step.ts`, `ai-turn.ts`, `runtime.ts`, `ai/*.ts` | 20fe7d5 | engine-reliability (JSON roto, truncado), harness F5 | — |
| P1-02 Idempotencia de reintentos | verified | `runtime.ts` (ai_turn_results), `tasks.ts`, migración 0004 | caddd4f | engine-reliability (1 tarea, 1 llamada, 1 consumo), harness F4 | Límite: Chatwoot no tiene clave idempotente en mensajes (ver 01 §C) |
| P1-03 Efectos tras toma humana | verified | `ai-turn.ts` (`withBotAuthority`), `opportunities.ts`, `tasks.ts`, `lead-fields.ts`, `outbound.ts` | caddd4f | engine-reliability "toma humana", harness S22 | — |
| P1-04 SSRF | verified | `src/server/http/ssrf.ts`, `src/server/ai/http.ts` | 7af817b | `tests/unit/ssrf.test.ts`, `tests/audit/ssrf.audit.test.ts` | DNS público (nip.io) solo verificable con red; cubierto por test de lookup local |
| P1-05 Límite de cuerpos | verified | `src/server/http/api.ts`, webhook route, uploads | 7af817b | `tests/unit/body-limit.test.ts`; HTTP real 50 MB → ver 02 | Límite en proxy: documentado, no probado (sin VPS) |
| P1-06 Nombre de contacto | verified | `ai-step.ts`, `sync.ts`, `ai-turn.ts` | 7af817b, 3570c6f | `tests/unit/contact-name.test.ts`, harness S34b | — |
| P1-07 Validación comercial | verified (reglas del servidor) | `src/lib/commercial-guard.ts`, `ai-turn.ts` | 20fe7d5, 3570c6f | `tests/unit/commercial-guard.test.ts` (25 casos), engine-reliability, harness S6 | Efectividad frente a un LLM real: NO VERIFICADA (P0-04) |
| P1-08 Catálogo con contexto | verified | `ai-turn.ts` (`catalogForTurn`) | 20fe7d5 | engine-reliability "¿y cuánto sale?", harness S4b | — |
| P1-09 Límites de consumo | verified | `bot-config.ts`, `runtime.ts` (`aiBudgetExceeded`), `ops/monitor.ts` | caddd4f, 3570c6f | engine-reliability "límite por contacto"; alertas 80/100 % en monitor | Default 40/conversación solo para bots nuevos (ver 01) |
| P1-10 Rate limiting | verified | `auth/index.ts`, `http/rate-limit.ts`, `http/api.ts`, `env.ts` | 5adde84 | `tests/integration/auth-rate-limit.test.ts` (IP falsificada, por cuenta, multi-instancia) | — |
| P1-11 Backups y monitoreo | verified (local) | `scripts/backup.sh`, `restore.sh`, `backup-restore-test.sh`, `src/server/ops/monitor.ts`, `infra/ops/*` | 3570c6f | Backup cifrado + copia rclone verificada + restore real + alerta de prueba (ver 06) | Almacenamiento externo real y canal de alertas reales: requieren cuentas del usuario |
| P1-12 CI | implemented | `.github/workflows/ci.yml`, `.gitleaksignore` | 3570c6f | Lint/typecheck/tests/build/gitleaks corridos localmente; el workflow no corrió en GitHub (sin push autorizado) | Push de la rama a GitHub |
| P1-13 Plantillas WhatsApp | verified (contrato v4.19 + Chatwoot real + E2E) | `services/templates.ts`, `outbound.ts`, route, `template-dialog.tsx`, `composer.tsx` | 2f43de7, dd963b9 | `tests/integration/whatsapp-templates.test.ts`, `tests/e2e/templates.spec.ts`, Chatwoot real R7 | Envío real a Meta: P0-01 |
| P1-14 Suspensión | verified | `src/server/http/api.ts`, rutas de resguardo | 5adde84 | `tests/integration/suspension-policy.test.ts` | — |
| P2-04 Etapas en cotización | verified | `ai-turn.ts` | caddd4f | engine-reliability "cotización sin permiso" | — |
| P2-05 Doble ejecución | verified | `queue.ts`, `runtime.ts`, migración 0004 | caddd4f | engine-reliability "dos workers", "fencing", "ejecución abandonada" | — |
| P2-12 Typecheck | verified | `package.json`, `tsconfig.typecheck.json` | 7af817b | typecheck pasa con un archivo corrupto plantado en `.next/dev` y detecta errores reales | — |

Otros P2 (no ampliados): P2-01 RLS, P2-02 revocación global de sesiones, P2-03 historial vacío si Chatwoot falla, P2-06 CSP (HSTS documentado en el proxy), P2-07 open redirect, P2-08 adjuntos salientes, P2-09 validación/autorización, P2-10 polling, P2-11 autoinvitación de plataforma → ver `08_REMAINING_BLOCKERS.md`.
