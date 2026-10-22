# Loopchat

CRM SaaS multiempresa para **WhatsApp + IA** de **Loop Smiths**: bandeja compartida, pipeline de oportunidades, bots (por instrucciones y constructor visual) y panel de suscripciones. Chatwoot Community Edition funciona como motor de mensajería **separado**; la interfaz es 100 % propia.

> Estado: ver [`docs/execution-status.md`](docs/execution-status.md) y [`docs/qa-final.md`](docs/qa-final.md). La V1 está verificada localmente con simuladores de contrato; la validación con Meta/Chatwoot/IA reales está pendiente de credenciales (`BLOCKED_EXTERNAL`).

## Stack

Next.js 16 (App Router, TypeScript estricto) · React 19 · Tailwind 4 · PostgreSQL 16 + Drizzle ORM · Better Auth · @xyflow/react · Vitest · Playwright · Chatwoot CE v4.19 (servicio aparte).

## Documentación

| Documento | Contenido |
|---|---|
| `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` | Especificación y reglas (fuente de verdad) |
| `docs/execution-status.md` | Estado por etapa, comandos y evidencia |
| `docs/bot-module.md` | Módulo de chatbots: catálogo, derivación, permisos, personalidad, memoria, objetivos, versiones |
| `docs/insult-detection.md` | Detección local de insultos: cobertura, límites y cómo ampliarla |
| `docs/ai-personality.md` | Identidad, objetivos y reglas de IA de la empresa; personalidad y objetivos por bot; jerarquía de instrucciones; versiones |
| `docs/bot-teams.md` | Equipos de chatbots: recepcionista, derivaciones entre bots, pipelines por bot, automatizaciones, versiones y simulador multiagente |
| `docs/deployment.md` | Despliegue en VPS (Loopchat + Chatwoot), TLS, variables |
| `docs/operations.md` | Operación, backups/restore, reconciliación, incidentes |
| `docs/qa-final.md` | Resultado de QA, pruebas pendientes con servicios reales |
| `docs/chatwoot-integration.md` | Contrato verificado con Chatwoot |
| `docs/permissions-matrix.md` | Roles y permisos |
| `docs/decisions.md` | Decisiones de ingeniería |
| `docs/brand-audit.md`, `docs/asset-sources.md` | Identidad visual y assets |

## Requisitos

- Node.js 20.9+ (probado con 22) y npm
- PostgreSQL 16 (local o `docker compose -f docker-compose.dev.yml up -d`)
- Para E2E: Chromium de Playwright (`npx playwright install chromium`; o `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<ruta>` para usar uno ya instalado)
- Bases `loopchat_test` y `loopchat_e2e` creadas (el `docker-compose.dev.yml` las crea; con Postgres propio: `CREATE DATABASE loopchat_test OWNER loopchat; CREATE DATABASE loopchat_e2e OWNER loopchat;`)

## Puesta en marcha local

### Linux / macOS

```bash
npm ci
cp .env.example .env          # completar BETTER_AUTH_SECRET y LOOPCHAT_ENCRYPTION_KEYS (ver comentarios)
docker compose -f docker-compose.dev.yml up -d   # si no tenés Postgres local
npm run db:migrate
npm run db:seed:plans
npm run db:seed:demo          # empresas y usuarios DEMO (contraseña: demo-loopchat-123)
npm run dev                   # http://localhost:3000
```

### Windows (PowerShell)

```powershell
npm.cmd ci
Copy-Item .env.example .env   # completar BETTER_AUTH_SECRET y LOOPCHAT_ENCRYPTION_KEYS
docker compose -f docker-compose.dev.yml up -d
npm.cmd run db:migrate
npm.cmd run db:seed:plans
npm.cmd run db:seed:demo
npm.cmd run dev
```

Generar secretos (cualquier sistema): `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` y `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`.

### Probarlo en Windows con un doble clic

Requisitos: **Node.js 20+** y **Docker Desktop** abierto (o un PostgreSQL 16 local con usuario/clave `loopchat`/`loopchat`).

1. Doble clic en `iniciar-demo.cmd`: crea `.env` con secretos aleatorios en modo simuladores, levanta PostgreSQL, instala dependencias, recrea la base DEMO, abre 3 ventanas (simulador de Chatwoot, simulador de IA y la app) y abre `http://localhost:3000/login`.
2. Entrar con `admin@ferreteria.demo.loopchat.test` / `demo-loopchat-123` (los demás usuarios se listan en la ventana).
3. `mensaje-demo.cmd "Hola, precio del taladro?"` simula un WhatsApp entrante; el bot DEMO responde con la FAQ.
4. `chat-cliente-demo.cmd` abre un chat por consola: escribís como si fueras el cliente y ves las respuestas del bot o del vendedor.
5. `detener-demo.cmd` apaga todo.

Los datos (API keys, bots, conversaciones) se conservan entre reinicios: el simulador de Chatwoot guarda su estado en `storage/chatwoot-sim-state.json`. Para borrar todo y empezar de cero: `reiniciar-demo-desde-cero.cmd`.

### Probar el flujo completo sin credenciales externas (simuladores)

Los simuladores reproducen los contratos de Chatwoot v4.19 (incluida la firma de webhooks), la Graph API de Meta (solo lectura) y los proveedores de IA. **No son servicios reales** y nunca se usan en producción.

```bash
# en .env: CHATWOOT_BASE_URL=http://localhost:3011  CHATWOOT_PLATFORM_TOKEN=sim-platform-token
#          CHATWOOT_WEBHOOK_TARGET_URL=http://localhost:3000  META_GRAPH_BASE_URL=http://localhost:3011/meta-graph/v22.0
#          LOOPCHAT_ALLOW_PRIVATE_URLS=true  LOOPCHAT_INLINE_WORKER=true  LOOPCHAT_DEMO_MODE=true
npm run sim:chatwoot          # terminal 1
npm run sim:ai                # terminal 2
npm run dev                   # terminal 3
npm run db:seed:demo-sim      # conecta las empresas DEMO a los simuladores y genera conversaciones
```

Usuarios DEMO: `admin@ferreteria.demo.loopchat.test`, `manager@…`, `agente@…`, `agente2@…`, `lectura@…` (empresa A), `admin@optica.demo.loopchat.test` (empresa B) y `plataforma@demo.loopchat.test` (panel Loop Smiths). Para simular un mensaje entrante: `curl -X POST localhost:3011/__sim/incoming -H 'content-type: application/json' -d '{"accountId":<id>,"phone":"+5491100000000","name":"Cliente","content":"Hola"}'` (el id aparece en `/admin`).

## Calidad

```bash
npm run lint
npm run typecheck
npm run test            # unit + integración (usa TEST_DATABASE_URL; levanta los simuladores)
npm run test:e2e        # Playwright: escritorio 1440 px, móvil 390 px y axe-core (usa loopchat_e2e, puertos 3011/3012/3100)
node scripts/capture-evidence.mjs   # capturas 1440/768/390 en docs/evidence (requiere app + db:seed:demo-sim)
npm run build
npm audit --omit=dev
```

## Producción

Ver [`docs/deployment.md`](docs/deployment.md). Resumen: Chatwoot CE en VPS con `infra/chatwoot/docker-compose.yml`; Loopchat (web + worker + Postgres propio) con `infra/loopchat/docker-compose.yml`; primer administrador con `npm run bootstrap:admin`. **No desplegar ni declarar validado sin la prueba real con Meta** (ver `docs/qa-final.md`).
