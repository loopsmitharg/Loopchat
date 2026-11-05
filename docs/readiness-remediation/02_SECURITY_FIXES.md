# 02 — Correcciones de seguridad

**Fecha:** 2026-11-05 · Referencia: `docs/audits/03_SECURITY_AUDIT.md`. "Antes" = auditoría del 2026-11-04 sobre `ecbf4e2`.

| Hallazgo | Antes | Corrección | Evidencia después | Estado |
|---|---|---|---|---|
| SEC-02 / P1-04 SSRF en URL de IA | Aceptaba `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, `[::ffff:a9fe:a9fe]` y nombres DNS a IPs privadas | Rangos reservados IPv4/IPv6 (incl. embebidas), lookup DNS validado en la conexión real, sin redirecciones, respuesta ≤ 5 MB | `tests/unit/ssrf.test.ts` (19 URLs bloqueadas, 4 públicas aceptadas, `localhost.` bloqueado en el lookup sin que el servidor interno reciba la conexión, redirección rechazada); `tests/audit/ssrf.audit.test.ts` sin bypass (`evidence/ssrf-results.json`) | verified |
| SEC-03 / P1-05 Cuerpos sin límite | Webhook público leía 50 MB y respondía 413 a los **2.020 ms** | Lectura acotada del stream (Content-Length y chunked), clave del webhook validada antes de leer, multipart acotado, límite en proxy documentado | Build de producción: 50 MB chunked → **413 en 121 ms** sin leer más de 512 KB; clave inválida → 404 en 6 ms; `tests/unit/body-limit.test.ts` (corta antes de ~640 KB) | verified (proxy: documentado) |
| SEC-04 / P1-06 Inyección por nombre de perfil | Nombre crudo en el prompt de sistema (S34b FAIL) | Saneamiento NFKC + bloque rotulado como dato; títulos automáticos saneados | `tests/unit/contact-name.test.ts`; harness S34b PASS | verified |
| SEC-06 / P1-10 Rate limits | En memoria por proceso; IP del primer `X-Forwarded-For`; sin 429 en dev | Postgres compartido, límite por cuenta, `TRUSTED_PROXIES` obligatorio en producción, misma resolución de IP en toda la app | `tests/integration/auth-rate-limit.test.ts`: 429 al 9.º intento aunque se falsifique XFF; límites que persisten al recrear la instancia (simula multi-instancia/reinicio); 429 al 11.º intento por cuenta desde 11 IPs. Build de producción: T12 con 429 | verified |
| SEC-08 / P1-14 Suspensión parcial | Crear bots, rotar credenciales, editar miembros, etc. seguían permitidos | Política única en `tenantRoute` + lista explícita de acciones de resguardo | `tests/integration/suspension-policy.test.ts` (7 escrituras → 422; lectura 200; deshabilitar usuario y revocar IA permitidos; reactivación) | verified |
| P1-03 (seguridad de IA) Efectos tras toma humana | Tarea y oportunidad creadas después de la toma (S22 PARTIAL) | Autoridad transaccional del bot | engine-reliability + harness S22 PASS | verified |
| P1-07 (seguridad de IA) Contenido comercial | Descuento inventado enviado (S6 PARTIAL) | Validación comercial en servidor | 25 casos unitarios + S6 PASS | verified (LLM real: no) |
| P1-01 (seguridad de IA) Salida malformada | JSON crudo al cliente (F5 FAIL) | Nunca se envía; reintento/derivación | F5 PASS + integración | verified |

## Aislamiento multiempresa (regresión)

| Prueba | Resultado |
|---|---|
| Sondas HTTP A↔B sobre el **build de producción** (`tests/audit/http-tenancy.audit.mjs`) | **12/12 PASS**: 32 accesos cruzados por ID sin fugas, IDs de B en cuerpos → 404, cookie de empresa forzada ignorada, roles 403, CSRF 403, sin secretos en listados, webhook inválido 404, límite de login 429 |
| Tests existentes de aislamiento (servicios, E2E) | En verde dentro de 270/270 y 27/27 |
| CI | Las sondas A/B quedan en el job `e2e` del workflow (no ejecutado aún en GitHub) |

Una muestra sin fugas no garantiza aislamiento total: no hay RLS como segunda barrera (P2-01 pendiente).

## Herramientas

| Herramienta | Versión | Resultado |
|---|---|---|
| npm audit `--omit=dev --audit-level=high` | npm 11.17 | 0 altas/críticas (4 moderadas en `esbuild` vía `drizzle-kit`, herramienta de migraciones) |
| Gitleaks | 8.21.2 (binario oficial) | Historial completo: 2 coincidencias, ambas valores ficticios de fixtures de test creados en esta remediación → registradas por huella en `.gitleaksignore`; luego 0 |
| Semgrep | 1.95.0 | **NO EJECUTADO localmente**: no tiene binario nativo para Windows. Configurado en CI (contenedor oficial) |
| ESLint / TypeScript | 9.39 / 5.9 | 0 errores, 0 advertencias |

## Hallazgo nuevo (integración real)

Chatwoot v4.19 descarta webhooks cuyo destino resuelve a IPs privadas (filtro SSRF de Chatwoot, `SafeFetch`). Si `CHATWOOT_WEBHOOK_TARGET_URL` apunta a una red interna, **no llega ningún mensaje** a Loopchat y no hay error visible para el usuario. Documentado en `.env.example` y `docs/deployment.md`: usar la URL pública HTTPS de Loopchat. Recomendación adicional: alertar si no llegan webhooks durante un período con actividad (no implementado).
