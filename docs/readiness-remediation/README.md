# Remediación P0/P1 — 2026-11-05

Rama `fix/loopchat-production-readiness` sobre `ecbf4e2`. Informes:

| Archivo | Contenido |
|---|---|
| `00_PROGRESS_REGISTER.md` | Matriz persistente de hallazgos (estado, archivos, commit, evidencia, bloqueos) |
| `01_IMPLEMENTATION_REPORT.md` | Causas raíz y correcciones |
| `02_SECURITY_FIXES.md` | Seguridad: antes/después y herramientas |
| `03_CONVERSATION_REGRESSION.md` | 50 escenarios antes/después |
| `04_PERFORMANCE_COMPARISON.md` | Mediciones antes/después y viabilidad del VPS |
| `05_INTEGRATION_VALIDATION.md` | Chatwoot real, Meta e IA (real vs. simulado) |
| `06_OPERATIONS_READINESS.md` | Backups, monitoreo, alertas, CI, despliegue |
| `07_UPDATED_READINESS_SCORE.md` | Nueva calificación ponderada |
| `08_REMAINING_BLOCKERS.md` | Pendientes y acciones |
| `09_EXECUTIVE_REPORT.md` | Resumen para los fundadores |

Evidencia cruda en `evidence/` (sin secretos ni datos reales). La evidencia de la auditoría original se conserva en `docs/audits/evidence/`.

Repetir las validaciones:
```bash
npm run lint && npm run typecheck && npm run test && npm run test:e2e
npx vitest run -c tests/audit/vitest.audit.config.mts                      # 50 escenarios + SSRF (Chatwoot real se omite sin variables)
CHATWOOT_REAL_URL=http://localhost:3001 CHATWOOT_REAL_PLATFORM_TOKEN=… npx vitest run -c tests/audit/vitest.audit.config.mts tests/audit/chatwoot-real.audit.test.ts
node tests/audit/http-tenancy.audit.mjs http://localhost:3000             # app con datos DEMO
```
