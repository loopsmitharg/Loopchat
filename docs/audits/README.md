# Auditoría integral — 2026-11-04

Informes: `01_ARCHITECTURE_REVIEW.md` · `02_FUNCTIONAL_AUDIT.md` · `03_SECURITY_AUDIT.md` · `04_CONVERSATION_TESTS.md` · `05_PERFORMANCE_AND_INFRASTRUCTURE.md` · `06_READINESS_SCORE.md` · `07_ROADMAP_TO_PRODUCTION.md` · `08_EXECUTIVE_SUMMARY.md`.
Evidencia cruda: `evidence/*.json`. No contiene credenciales ni datos personales reales (solo datos DEMO/ficticios).

## Instrumentos nuevos (no tocan lógica productiva; no forman parte de `npm test`)

| Archivo | Qué hace | Cómo correrlo |
|---|---|---|
| `tests/audit/conversations.audit.test.ts` | 50 escenarios conversacionales sobre el motor real con IA guionada y Chatwoot simulado | `npx vitest run -c tests/audit/vitest.audit.config.mts` (requiere PostgreSQL con `loopchat_test`) |
| `tests/audit/ssrf.audit.test.ts` | Casos de bypass del guard SSRF en modo producción | idem |
| `tests/audit/http-tenancy.audit.mjs` | Sondas HTTP A↔B, roles, CSRF, secretos, webhook, login | app local + `npm run db:seed:demo && npm run db:seed:demo-sim`; `node tests/audit/http-tenancy.audit.mjs` |
| `tests/audit/load.audit.mjs` | Carga HTTP de lectura con concurrencia 1/10/25/50 | build de producción local; `node tests/audit/load.audit.mjs http://localhost:3200` |
| `.claude/launch.json` | Configuración para levantar app y simuladores desde el panel de vista previa | opcional |

## Herramientas y versiones usadas

| Herramienta | Versión | Uso |
|---|---|---|
| Node.js / npm | 24.19.0 / 11.17.0 | runtime (el proyecto pide ≥ 20.9; probado antes con 22) |
| PostgreSQL (embebido, `embedded-postgres@17.5.0-beta.15`, aislado en carpeta temporal) | 17.5 | Docker Desktop no arrancó en el equipo; el proyecto apunta a PG 16 |
| Vitest | 5.0.5 | suite existente + harness |
| Playwright / Chromium headless shell | 1.56.1 / 141.0.7390.37 | E2E existente |
| ESLint / TypeScript | 9.39.5 / 5.9.3 | lint y typecheck |
| npm audit | 11.17.0 | dependencias |
| Revisión de secretos | `git log -p --all` + patrones | en lugar de Gitleaks (no instalado) |

No se usaron: Semgrep, Gitleaks, Trivy, OWASP ZAP (ver motivo en `03 §1`). No se usaron claves reales ni servicios externos.

## Nota de entorno
`npm run typecheck` falló por un archivo generado corrupto en `.next/dev/types` (caché local de una sesión anterior). El typecheck de las fuentes reales (excluyendo esa caché) pasa sin errores. Ver P2-12.
