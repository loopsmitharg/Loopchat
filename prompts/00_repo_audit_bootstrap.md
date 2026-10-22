# Etapa 00 — Auditoría de repositorio, herramientas y bootstrap

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** identificar el estado real del repositorio y dejar una base ejecutable y versionada, sin sobreescribir trabajo previo.

**Inspeccionar antes:** árbol/estado Git, README, lockfile, `package.json`, rutas, `.env*`, tests existentes; detectar si Next.js ya está configurado y si hay secretos rastreados. Auditar disponibilidad de Node, npm y Docker. Revisar la marca en `https://loop-smith.com` y el CSS histórico enlazado desde el documento visual.

**Implementar:**
- Si el proyecto ya existe, conservarlo y completar solo carencias. Si el repo está vacío, bootstrap con Next.js App Router, TypeScript estricto, Tailwind, ESLint, npm y lockfile.
- Crear scripts mínimos `dev`, `lint`, `typecheck`, `test`, `build` (test inicial real de configuración, no suite falsa), README, `.env.example`, `.gitignore` y `docs/execution-status.md`.
- Intentar instalar una vez las cinco skills especificadas en `PROMPT_SYSTEM.md`, previo chequeo de procedencia. Documentar resultados y evitar reinstalación permanente.
- Auditar paleta/activos actuales: guardar `docs/brand-audit.md`, con URLs, fuente, fecha, diferencias y capturas cuando posible. No inventar logo.
- Preparar Docker/config de desarrollo solo si ya es necesario; no desplegar Chatwoot real aún.

**No tocar:** cuentas externas, VPS, API keys, pagos, componentes avanzados.

**Aceptación:** app arranca, scripts de lint/typecheck/test/build ejecutables, configuración de Git no incluye secretos, brand audit con nivel real de verificación; si no hubo acceso al sitio, paleta queda provisional. Registrar evidencia en status.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
