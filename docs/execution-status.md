# Estado de ejecución — Loopchat V1

**Última actualización:** 2026-11-25 (Fase 2: VPS preparado; ver sección "Fase 2") · **Agente:** implementación autónoma (Claude) · **Entorno de verificación:** Linux (Node 22, PostgreSQL 16, Chromium 1194), sin acceso a Docker Hub, Meta ni proveedores de IA reales.

Leyenda: `IMPLEMENTED` código completo · `VERIFIED_LOCAL` pruebas locales automatizadas pasan · `VERIFIED_REAL` probado contra servicios reales · `BLOCKED_EXTERNAL` depende de acceso externo · `NOT_DONE` no realizado.

## Resumen

| Etapa | Estado | Bloqueo externo |
|---|---|---|
| 00 Auditoría y bootstrap | VERIFIED_LOCAL | Skills de terceros inexistentes (registrado) |
| 01 Sistema visual y navegación | VERIFIED_LOCAL | — |
| 02 Tenants, auth, datos, RBAC | VERIFIED_LOCAL | SMTP real (emails van a `dev_mail_outbox` en dev) |
| 03 Chatwoot aislado y contrato | VERIFIED_LOCAL (contra simulador de contrato v4.19) | **BLOCKED_EXTERNAL**: Chatwoot real (Docker Hub bloqueado en este entorno) |
| 04 Bandeja humana | VERIFIED_LOCAL | **BLOCKED_EXTERNAL**: Meta + Chatwoot reales |
| 05 Contactos y pipeline | VERIFIED_LOCAL | — |
| 06 IA BYOK y bot básico | VERIFIED_LOCAL (simulador de proveedores) | **BLOCKED_EXTERNAL**: claves reales de OpenAI/Anthropic/Gemini |
| 07 Constructor visual y runtime | VERIFIED_LOCAL | — |
| 08 Conocimiento, tareas | VERIFIED_LOCAL | — |
| 09 Onboarding y configuración | VERIFIED_LOCAL | **BLOCKED_EXTERNAL**: activos Meta del cliente |
| 10 Planes, cuotas, panel SaaS | VERIFIED_LOCAL | — |
| 11 Dashboard y operaciones | VERIFIED_LOCAL | — |
| 12 QA, seguridad, responsive | VERIFIED_LOCAL | Pruebas reales listadas en `qa-final.md` |
| 13 Ship V1 | **VERIFIED_LOCAL / BLOCKED_EXTERNAL** (no `SHIPPED`) | Despliegue y validación real requieren VPS, dominio, Meta y claves IA |

## Preparación para VPS — Fase 1 (2026-11-23) — rama `fix/loopchat-production-readiness`

Sin despliegue: todavía no hay VPS, dominio confirmado ni cuenta de Resend. Procedimiento: `docs/migracion-vps.md`.

| Área | Estado | Evidencia |
|---|---|---|
| Estado real local: Todo Trabajo con IA real `PruebaOficial` (verificada 22/11) y 2 números WhatsApp `connected` | VERIFIED_REAL (consulta a la base local) | Corrige las filas Meta/IA de la sección 2026-11-21 |
| Next.js 16.4.2 → 16.4.6 (+ `eslint-config-next`): corrige los 7 avisos de Next | VERIFIED_LOCAL | `npm audit --omit=dev`: quedan 4 *moderate* de `drizzle-kit`→esbuild (solo servidor de desarrollo); `--audit-level=high` PASS |
| `.dockerignore` (antes la imagen copiaba `.env`, `storage/` y `node_modules` del host) | IMPLEMENTED + VERIFIED_LOCAL | build de la imagen OK |
| Dockerfile: `/data/storage` con dueño `loopchat` (el volumen quedaba de root y no se podían subir archivos) | VERIFIED_LOCAL | el import del ensayo escribe en el volumen como `loopchat` |
| Compose Loopchat: healthcheck de la base + `depends_on: service_healthy`; monitor con `TRUSTED_PROXIES` (antes no arrancaba en producción) | VERIFIED_LOCAL | ensayo: app, worker y monitor arriba |
| `infra/loopchat/env.production.example`, Resend en Loopchat y Chatwoot, `infra/caddy/Caddyfile` con dominios por variable | IMPLEMENTED; Caddyfile VERIFIED_LOCAL (`caddy adapt`, Caddy 2) | Resend real: **BLOCKED_EXTERNAL** (API key + dominio verificado) |
| Flujos de email con la imagen de producción y SMTP local Mailpit (**no** Resend): alta de empresa, invitación desde /admin y desde la empresa, aceptar invitación, restablecer contraseña, login con la nueva | VERIFIED_LOCAL 17/17 | links con `APP_URL` https, cookies `__Secure-`, sin `devUrl` expuesto |
| `scripts/migration/export-local.ps1` (corte + export) | IMPLEMENTED, **no ejecutado** (detiene el entorno local; queda para el día del corte) | ensayo con volcados equivalentes de solo lectura |
| `scripts/migration/import-vps.sh` (restore conjunto + verificación) | VERIFIED_LOCAL (ensayo en proyectos Docker aislados) | SHA256 OK; conteos idénticos en 22 tablas de Loopchat + 13 de Chatwoot; 15/15 credenciales descifradas; 6 webhooks re-apuntados; `/api/health` 200 |
| `dev-start.ps1` se niega a arrancar si la PC ya fue migrada (`storage/run/MIGRATED_TO_VPS`) | IMPLEMENTED | — |
| Error del worker `Chatwoot: Invalid Access Token` | Diagnosticado: solo empresas DEMO (cuentas del simulador); Todo Trabajo sincroniza bien | borrar las empresas DEMO en producción |

Comandos: `npm run typecheck` PASS · `npm run lint` PASS (se excluyen `.agents/` y `.claude/`) · `npm test` 270/271 en la corrida con el build de Docker en paralelo; el que falló (`engine-reliability`, umbral de 1500 ms, midió 1897 ms) pasa 16/16 repetido solo · audit vitest 16 PASS / 2 skipped (requieren Chatwoot real) · build de producción dentro de la imagen PASS.
No ejecutado: E2E Playwright y sondas HTTP de aislamiento (corren en CI), `chatwoot-real.audit` (requiere Chatwoot real configurado para el test), pruebas con Meta, IA y Resend reales.

## Backups en R2 dentro de la franquicia gratuita (2026-11-25) — rama `fix/loopchat-production-readiness`

| Ítem | Estado | Evidencia |
|---|---|---|
| Tamaño real de un backup completo | VERIFIED_LOCAL | dumps de las bases locales: Loopchat 0,32 MB + Chatwoot 0,43 MB, archivos 0 → 752 KB cifrado; 8 copias ≈ 6 MB |
| Tope 8 GB (cuenta entera), aviso 6 GB, ops 80/95 %, retención 7 días, nunca borra la última copia completa, falla cerrada | VERIFIED_LOCAL | `tests/unit/r2-budget.test.ts` 8/8; `backup.sh` real contra R2 simulado (alias rclone + API GraphQL simulada): ok (borró 2 vencidas + 1 incompleta, conservó la reciente, subió y verificó), sin espacio / ops 96 % / API caída → no sube, remoto sin cambios, copia local conservada |
| Restore desde la copia "bajada" | VERIFIED_LOCAL | `backup-restore-test.sh`: conteos OK, 15/15 secretos descifrables; Chatwoot restaurado en base temporal con conteos idénticos (6/33/102/31/8) |
| Bug: imagen con `pg_dump` 15 contra PostgreSQL 16 (el backup no podía correr) | VERIFIED_LOCAL | Dockerfile instala `postgresql-client-16` (PGDG); imagen completa reconstruida: `pg_dump` 16.16 |
| Adjuntos de Chatwoot: copia incremental cifrada a R2 (una vez por archivo, dentro del tope de 8 GB) | VERIFIED_LOCAL | `tests/unit/r2-budget.test.ts` 13/13; `npm run test:backup` 15/15 con la imagen real reconstruida (`pg_dump` 16.16): cifrado (sin texto plano en R2), sin re-subidas, reparación de subida incompleta, retención de huérfanos, sin espacio / API caída → no sube; restore con 4/4 adjuntos con MD5 original y 3 mensajes con adjuntos; adjunto corrupto → la prueba falla. Repetido con el esquema real de Chatwoot (`CW_SCHEMA_DUMP`, 102 mensajes): 15/15 |
| Bug: con Loopchat y Chatwoot en el mismo servidor, la prueba de restore usaba el mismo nombre de base temporal | IMPLEMENTED | detectado por la prueba e2e; base de Chatwoot con sufijo `_chatwoot` |
| R2 real (bucket, tokens, primera subida y restore) | BLOCKED_EXTERNAL | faltan cuenta/tokens; **timer diario NO activado** |

## Fase 2: VPS preparado (2026-11-25) — Contabo `212.28.183.78`

| Área | Estado | Evidencia |
|---|---|---|
| SSH por clave (usuario `deploy`, sudo con contraseña); `permitrootlogin no`, `passwordauthentication no` | VERIFIED_REAL | `sshd -T` |
| Ubuntu 24.04.5 actualizado, sin salto a 26.04 (`Prompt=never`); swap 2 GB | VERIFIED_REAL | reiniciado: kernel 6.8.0-151, servicios arriba solos |
| ufw IPv4/IPv6: SSH con límite; 80/443 solo desde Cloudflare (15 rangos v4 + 7 v6); fail2ban `sshd` | VERIFIED_REAL | `ufw status verbose`; conexión SSH nueva OK con el firewall activo |
| Docker 29.10.1 + Compose v5.8.0 (repo oficial), logs rotados; Caddy 2.11.9 (repo oficial), deshabilitado | VERIFIED_REAL | `hello-world` OK |
| Repo en `/opt/loopchat` @ `e05cacf`; `/etc/loopchat` (750), `/var/backups/loopchat` (700) | VERIFIED_REAL | — |
| Compose de Loopchat y Chatwoot + Caddyfile | VERIFIED_REAL (`config` con valores de relleno, borrados al terminar; `caddy adapt`) | puertos solo en `127.0.0.1:3000` y `127.0.0.1:3001` |
| DNS `app.` y `chatwoot.loopchat.com.ar` en Cloudflare (proxied) | VERIFIED_REAL | responden 521 (sin origen todavía) |
| Certificado de origen de Cloudflare (ECC, hasta 2041) en Caddy; Full (strict) | VERIFIED_REAL: par clave/cert verificado, `caddy validate` como usuario caddy OK; Caddy deshabilitado hasta el corte | dominios siguen en 521 (sin origen activo) |

No se migraron bases, no hay `.env` en el servidor, ninguna app levantada ni pública.

## Resend real y superadmin (2026-11-24) — rama `fix/loopchat-production-readiness`

Dominio `loopchat.com.ar` verificado en Resend (São Paulo). Remitente `Loopchat <no-reply@loopchat.com.ar>`. La API key está
solo en los `.env` privados de la PC (`.env` → `SMTP_URL`; `infra/chatwoot/.env` → `SMTP_PASSWORD`); nunca se imprimió.

| Prueba | Estado | Evidencia (id de Resend) |
|---|---|---|
| A · SMTP de Loopchat (`SMTP_URL`, 465 TLS implícito, nodemailer como la app) → cargerich8@gmail.com | VERIFIED_REAL: aceptado y **delivered** | `01a20fd4-831d-73fb-a7b0-5c1c85144440` |
| E · parámetros SMTP de Chatwoot (587 STARTTLS, `plain`, usuario `resend`, verificación `peer`) desde Node | VERIFIED_REAL: delivered | `01a20fd4-8fad-7d27-808c-813c733b3737` |
| E · envío desde Chatwoot mismo | **PENDIENTE**: los contenedores locales se crearon sin SMTP y recrearlos reinicia el entorno local | primer reset del superadmin de Chatwoot en el VPS |
| B · superadmin `cargerich8@gmail.com` con `bootstrap:admin` | VERIFIED_LOCAL: `platform_admin`, 0 membresías, 1 solo usuario con ese email; login y API de plataforma 200 (en copia aislada) | se activa por recuperación de contraseña (bootstrap no envía mail) |
| C · recuperación de contraseña real (copia aislada, `APP_URL=https://app.loopchat.com.ar`) | VERIFIED_REAL el envío: delivered; enlace absoluto `https://app.loopchat.com.ar/api/auth/reset-password/<token>?callbackURL=%2Frestablecer%2Fnueva`, vence en 30 min. **Enlace PENDIENTE** (el dominio todavía no apunta a un servidor; el token era de la copia, ya borrada) | `01a20fe2-88b2-7c9d-b7c2-30d01c35b1f9` |
| D · invitación desde /admin (copia aislada, empresa DEMO, rol lectura) | VERIFIED_REAL el envío: delivered; enlace `https://app.loopchat.com.ar/invitacion/<token>`, vence en 7 días, sin `devUrl` en la respuesta. **Enlace PENDIENTE** (misma razón) | `01a20fe2-8201-78ed-8d86-93f7722e7327` |

Correcciones: en el `.env` privado `SMTP_URL` tenía el puerto `46` (debía ser `465`) y `MAIL_FROM=no-reply@localhost`;
se quitó una variable `Resend=` que el código no usa (la clave ya estaba en `SMTP_URL`). `infra/chatwoot/.env` no tenía SMTP.
`sendMail` ahora registra la respuesta SMTP del proveedor (incluye el id de Resend) y, si falla, `mail.failed` con código y
respuesta del servidor, nunca `SMTP_URL`. Sin reintentos automáticos de envío: cada pedido genera un solo mail.

Efecto local: con el `.env` nuevo, la app local (si se vuelve a levantar) envía correos reales por Resend.

## Cierre de la Fase 1 (2026-11-23, noche) — rama `fix/loopchat-production-readiness`

| Área | Estado | Evidencia |
|---|---|---|
| CI en GitHub (commit `a098d8a`): job *Lint, typecheck, tests, build* | VERIFIED (GitHub Actions) | lint, typecheck, test, audit vitest, build y `npm audit --audit-level=high` en verde; Gitleaks en verde |
| CI: Semgrep fallaba (todas las corridas de la rama) | Corregido, VERIFIED_LOCAL | hallazgo real `gcm-no-tag-length` en `src/server/crypto/vault.ts`: el descifrado fija `authTagLength: 16` (los secretos ya guardados usan tags de 16 bytes y siguen descifrando); test nuevo que rechaza un tag truncado. Semgrep 1.95.0 con la config de CI: sin hallazgos |
| CI: `npx playwright install --with-deps chromium` falla en GitHub | **BLOCKED** (sin acceso al log) | el mismo comando en un contenedor Ubuntu 24.04 limpio termina bien (exit 0); `ubuntu-latest` sigue siendo 24.04. GitHub exige iniciar sesión para ver el log del paso |
| Playwright local (escritorio 1440, móvil 390, axe-core) con `CI=true` | VERIFIED_LOCAL 27/27 | corrida completa 26/27; `bot-teams.spec` falló por tiempo (compilación bajo demanda de `next dev` en Windows) y pasa sola (42 s) |
| Unit + integración local | VERIFIED_LOCAL 272/272 | `npm test` |
| Exclusión de secretos | VERIFIED_LOCAL | `.env*`, `infra/chatwoot/.env`, `storage/` (backups, migración, contraseña local), `*.pem`, `marketing/`, skills locales ignorados; se agregan `*.dump`, `*.key`, `*.enc`. `git ls-files` sin archivos sensibles |
| Dominios | Configurados | `app.loopchat.com.ar`, `chatwoot.loopchat.com.ar`, remitente `no-reply@loopchat.com.ar` (actualizado el 2026-11-24). DNS: el dominio usa nameservers de Cloudflare; los tres subdominios todavía no tienen registros |
| Checklist de cuentas de prueba | IMPLEMENTED (no ejecutado: es para el VPS) | `docs/correccion-cuentas-demo.md` |

**Medición de recursos** (Docker Desktop, entorno real local + imagen de producción de Loopchat con base vacía, después de recorrer las pantallas):

| Servicio | RAM |
|---|---|
| Chatwoot rails / sidekiq / postgres / redis | 372 / 442 / 66 / 12 MB |
| Loopchat app / worker / monitor / postgres | 164 / 188 / 88 / 70 MB |
| **Total contenedores** | **≈ 1,4 GB** |

Disco: imágenes ≈ 5,6 GB (Chatwoot 2,7; Loopchat 1,8; pgvector 0,65; postgres 0,4); datos: base Loopchat 14 MB, base Chatwoot 21 MB, adjuntos 0. Conclusión: **8 GB alcanzan** (Chatwoot crece con carga y el `next build` dentro de Docker es el pico, ~2–3 GB); 12 GB solo si se suman muchas empresas activas; 16 GB no se justifica. Medición en reposo y carga liviana: no es una prueba de carga.

No ejecutado: corte, cambios en Meta, borrado de empresas DEMO (por indicación), push.

## Entorno local real + Todo Trabajo (2026-11-21) — rama `fix/loopchat-production-readiness`

Informes en `docs/local-whatsapp-setup/` (01–09). Nada desplegado ni fusionado.

| Área | Estado | Evidencia |
|---|---|---|
| Docker, Chatwoot CE 4.19 real (Rails, Sidekiq, PostgreSQL, Redis), Loopchat web (`next start`) + worker | VERIFIED_REAL (local) | `06_TEST_RESULTS.md` §A |
| HTTPS público por Cloudflare Quick Tunnels (URLs temporales) | VERIFIED_REAL | §B |
| Integración Chatwoot ↔ Loopchat por webhook público firmado, SSRF de Chatwoot activo | VERIFIED_REAL — audit 10/10 + E2E con el worker en ejecución | §C |
| Empresa Todo Trabajo: perfil, 13 reglas, 7 documentos, 14 productos, 4 pipelines, 7 bots v2, equipo v2 activo | IMPLEMENTED + VERIFIED_LOCAL (simulador 19/19, IA simulada) | `09_TODO_TRABAJO_CHATBOTS.md` |
| `scripts/dev/dev-{start,stop,status,logs}.ps1` | VERIFIED_LOCAL (arranque desde cero, idempotencia, persistencia) | §A |
| Meta / WhatsApp Cloud | BLOCKED_EXTERNAL (credenciales) | `04_META_CONFIGURATION.md` |
| IA real | BLOCKED_EXTERNAL (clave) | `08_NEXT_STEPS.md` |

Comandos: `npm run db:migrate` (3 pendientes, con backup previo) · `npm run build` PASS · `npm run typecheck` PASS · `vitest tests/unit` 153/153 · `npm run lint`: errores solo en `.agents/skills` (ajeno al repo) · `tests/audit/chatwoot-real.audit.test.ts` 10/10 · `scripts/simulate-todo-trabajo.ts` 19/19 · `scripts/smoke-chatwoot-todo-trabajo.ts` PASS. Aviso: Next.js 16.4.2 reporta una vulnerabilidad conocida al compilar (actualizar en un PR propio).

## Remediación P0/P1 (2026-11-05) — rama `fix/loopchat-production-readiness`

Informes en `docs/readiness-remediation/` (registro persistente: `00_PROGRESS_REGISTER.md`; resumen: `09_EXECUTIVE_REPORT.md`). No fusionado a `main`, nada desplegado.

| Comando / prueba | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` (ahora reproducible) · `npm run build` | ✅ |
| `npm run test` | ✅ 30 archivos / 270 tests (antes 209) |
| `npm run test:e2e` | ✅ 27/27 en la primera corrida (nuevo `templates.spec.ts`) |
| Harness conversacional (50) | 49 PASS / 1 PARTIAL (S38, requiere LLM real) / 0 FAIL — antes 41/4/5 |
| Sondas HTTP A/B sobre build de producción | ✅ 12/12 |
| Chatwoot CE 4.19 **real** (Docker local, sin Meta) | ✅ 10/10 (`tests/audit/chatwoot-real.audit.test.ts`) |
| Backup cifrado + copia rclone verificada + restore real + alerta de prueba | ✅ local; bucket y canal reales: BLOCKED_EXTERNAL |
| `npm audit --omit=dev --audit-level=high` · Gitleaks | ✅ |
| Semgrep | NOT_DONE local (sin binario Windows); configurado en CI |
| CI en GitHub | IMPLEMENTED, no ejecutado (sin push autorizado) |
| P0-01 Meta real · P0-04 IA real | **BLOCKED_EXTERNAL** |

Migraciones nuevas: `0004_reliability` (aditiva, limpia duplicados activos), `0005_ops` (aditiva). Nota: **7,0/10** (calculada 7,25, tope por WhatsApp sin validar con Meta).

## Auditoría integral independiente (2026-11-04)

Informes en `docs/audits/` (resumen: `08_EXECUTIVE_SUMMARY.md`). Solo diagnóstico: **no se modificó lógica productiva**. Entorno: Windows 10, Node 24.19, PostgreSQL 17.5 embebido (Docker Desktop no arrancó), simuladores de contrato; sin Meta/Chatwoot/IA reales.

| Comando | Resultado |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ❌ por caché corrupta en `.next/dev/types`; typecheck de fuentes excluyendo esa caché ✅ |
| `npm run test` | ✅ 21 archivos / 209 tests (primera corrida falló 11 por base inicializada en WIN1252; recreada en UTF-8) |
| `npm run test:e2e` | ⚠️ 25/26; el fallido (`bot-module.spec.ts` "configuración del bot accesible") pasa aislado — inestable por timeout de login bajo carga |
| `npm run build` | ✅ |
| `npm audit --omit=dev` | ⚠️ 4 moderadas (esbuild vía drizzle-kit) |
| `tests/audit/conversations.audit.test.ts` (nuevo) | 50 escenarios: 41 PASS / 4 PARTIAL / 5 FAIL |
| `tests/audit/http-tenancy.audit.mjs` (nuevo) | 11/12 PASS; 0 fugas A→B; sin 429 de login en dev (esperado) |
| `tests/audit/ssrf.audit.test.ts` (nuevo) | Bypass con IPv6 mapeada y DNS a IP privada |
| `tests/audit/load.audit.mjs` (nuevo) | ≈400 req/s, p95 217 ms a 50 concurrentes, 0 errores |

Defectos abiertos priorizados en `docs/audits/07_ROADMAP_TO_PRODUCTION.md` (P0: validación real, mensajes concurrentes descartados, worker secuencial, IA real). Nota ponderada: **6,0/10** — listo para demo, no para piloto.

## Mejoras del módulo de chatbots (2026-10-21, tarde)

Detalle técnico en `docs/bot-module.md` y `docs/insult-detection.md`. Migración nueva: `drizzle/0001_bot_module.sql` (aditiva; se aplica sola con `npm run db:migrate`, incluido en `iniciar-demo.cmd`).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Detección de insultos y derivación sin IA | VERIFIED_LOCAL | `tests/unit/insults.test.ts` (57 casos: 6 idiomas, evasiones, falsos positivos); integración: 0 llamadas al proveedor, `requested`, responsable, tarea, motivo `insult_detection`; captura `sim-insult-1440.jpg`, `inbox-requested-1440.jpg` |
| 2 · Catálogo de productos | VERIFIED_LOCAL | CRUD, archivo, filtros, foto con firma real y acceso por empresa, asociación versionada, precio/stock en vivo sin republicar, el prompt marca “NO INFORMADO”; foto enviada como adjunto (simulador de contrato). Real: **BLOCKED_EXTERNAL** (Chatwoot/Meta) |
| 3 · Control humano y permisos | VERIFIED_LOCAL | Estado “Pide humano”, toma de conversación, sin respuestas tardías, reactivación manual o regla “al resolver”; etapas permitidas (nunca ganada), responsable y vencimiento máximo de tareas, bloqueos registrados |
| 4 · Personalidad, horarios, memoria, objetivos | VERIFIED_LOCAL | Estilo en el prompt, bienvenida única, fuera de horario (avisar/derivar), máximo de consultas sin resolver, memoria acotada, datos comerciales validados que no pisan datos humanos |
| 5 · Simulador, versiones, ejecuciones | VERIFIED_LOCAL | Snapshot de configuración por versión, “Recuperar como borrador”, aviso de cambios sin publicar, métricas por ejecución, simulador con casos y resumen (IA llamada, herramientas, bloqueos) sin efectos |

Corrida completa tras los cambios: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 17 archivos / 167 tests · `npm run test:e2e` ✅ 21/21 (incluye `bot-module.spec.ts`, axe sin violaciones graves en las 8 secciones, móvil 390 sin overflow) · `npm run build` ✅ · capturas 1440/768/390 sin overflow horizontal.

Errores encontrados y corregidos: `PATCH` parcial de bot reiniciaba herramientas/palabras clave (defaults de Zod 4 en `.partial()`) → esquemas de parche explícitos + test; comparación de versiones dependía del orden de claves de jsonb → JSON canónico; overflow de la tabla del simulador en 390 px → contenedor con scroll; checkbox de asociación sin estado optimista → corregido; `SkeletonRows` con `aria-label` sin rol → `role="status"`.

## Personalidad, objetivos y reglas de IA (2026-10-22)

Detalle en `docs/ai-personality.md`. Migración nueva: `drizzle/0003_ai_profile.sql` (aditiva; se aplica sola al iniciar la demo).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Auditoría y modelo de herencia | VERIFIED_LOCAL | Jerarquía plataforma → obligatorias → empresa → equipo → bot → datos (`src/lib/instructions/build.ts`) |
| 2 · Identidad, objetivos y reglas de empresa | VERIFIED_LOCAL | Configuración → Identidad y objetivos de IA; permisos (obligatorias solo administradores); aislamiento por empresa |
| 3 · Personalidad y objetivos por bot | VERIFIED_LOCAL | Selectores visuales, vista previa, plantillas predefinidas y propias, rol Posventa |
| 4 · Herramientas, conocimiento, pipeline, transferencias, operación | VERIFIED_LOCAL | Conocimiento restringido por fuentes, derivaciones determinísticas (alto valor, error de acción, límite de uso), parámetros del modelo con compatibilidad real, mensaje de transición opcional en equipos |
| 5 · Motor de instrucciones efectivas | VERIFIED_LOCAL | "Instrucciones efectivas", resolución de conflictos, huella registrada por ejecución |
| 6 · Plantillas y asistente de 8 pasos | VERIFIED_LOCAL | `/chatbots/nuevo` |
| 7 · Simulador, versiones y ejecuciones | VERIFIED_LOCAL | Escenarios nuevos, comparación con una versión, "Ver qué cambió", indicadores por bot |
| 8 · Pruebas y calidad | VERIFIED_LOCAL | Ver abajo. Real (IA del cliente): **BLOCKED_EXTERNAL** para evaluar el tono generado |

Corrida: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 21 archivos / 209 tests (nuevos: `instructions.test.ts`, `ai-profile.test.ts`) · `npm run test:e2e` ✅ 26/26 + recorrida visual sin errores de consola ni overflow a 1440 y 390 · `npm run build` ✅.

Errores encontrados y corregidos: claves React duplicadas en los selectores (opción "sin definir" vs. valor "none") detectadas por la recorrida de consola; selectores de prueba ambiguos; una regla común que pasaba a obligatoria se repetía en el prompt → se deduplica.

## Equipos de chatbots integrados con pipelines (2026-10-21, noche)

Detalle técnico en `docs/bot-teams.md`. Migración nueva: `drizzle/0002_bot_teams.sql` (aditiva; se aplica sola al iniciar la demo).

| Etapa | Estado | Evidencia |
|---|---|---|
| 1 · Arquitectura (roles, equipos, versiones, derivaciones, bot activo) | VERIFIED_LOCAL | Esquema + migración 0002; bots existentes quedan `custom` sin cambios de comportamiento ni "cambios sin publicar" |
| 2 · Orquestación (derivación sin IA primero, un bot activo, bucles, no disponibles, duplicados, respuestas tardías) | VERIFIED_LOCAL | `tests/unit/team-route.test.ts`; `tests/integration/bot-teams.test.ts` |
| 3 · Pipelines (pipeline por bot, oportunidad por contacto+pipeline, etapas autorizadas, recepcionista sin oportunidades, automatizaciones) | VERIFIED_LOCAL | Integración: pipeline de soporte vs. principal, etapa no autorizada bloqueada, etapa alcanzada → activa bot, cierre → detiene bot |
| 4 · Configuración, plantillas por rol, asistente de 8 pasos, editor visual | VERIFIED_LOCAL | `tests/e2e/bot-teams.spec.ts` (axe sin violaciones graves, sin overflow) |
| 5 · Simulador multiagente y versiones de equipo | VERIFIED_LOCAL | Simulación sin cambios en CRM ni Chatwoot; conversación en curso conserva su versión; resolver libera la fijación |
| 6 · Validación completa | VERIFIED_LOCAL | Ver corrida abajo. Real (Chatwoot/Meta/IA): **BLOCKED_EXTERNAL** |

Corrida tras los cambios: `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ 19 archivos / 197 tests (incluye 19 de integración de equipos y 11 unitarios) · `npm run test:e2e` ✅ 22/22 (nuevo `bot-teams.spec.ts`; `bots.spec.ts` adaptado al selector "Tipo de atención") · `npm run build` ✅ · capturas del editor y del simulador a 1440 y 390 sin overflow.

Errores encontrados y corregidos: la creación automática de oportunidades al primer mensaje convertía reclamos en ventas con un equipo activo → se omite con equipo activo; la etapa elegida por la IA al crear la oportunidad se descartaba (solo se aceptaba con oportunidad existente) → se acepta dentro de las etapas permitidas; un reintento después de una derivación podía responder con el bot anterior → la ejecución sigue al bot activo de la conversación; el cupo de bots contaba dos veces un bot activo también en un equipo → cada bot cuenta una vez; señales de intención duplicadas.

## Comandos y resultados (corrida completa V1, 2026-10-21)

| Comando | Resultado |
|---|---|
| `npm run lint` | ✅ 0 errores / 0 advertencias |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ 13 archivos, 83 tests (PostgreSQL real + simuladores) |
| `npm run test:e2e` | ✅ 18/18 (escritorio 1440, móvil 390, axe-core) |
| `npm run build` | ✅ |
| backup → restore → `npm run verify:restore` | ✅ conteos idénticos, 8/8 secretos descifrables |
| `node scripts/capture-evidence.mjs` | ✅ 20 capturas en `docs/evidence/`, sin overflow horizontal |

Errores encontrados y corregidos durante la verificación (no quedan abiertos): subconsultas correlacionadas con columnas no calificadas (contadores incorrectos) → corregido + test `aggregates`; columnas `started_at`/`received_at` mal mapeadas → corregido + test `ops`; reintento de evento entrante no re-disparaba el bot → corregido (disparo idempotente); toasts ocultos detrás de modales → top layer; envío del login antes de hidratar → formulario `post` + bloqueo hasta hidratar; overflow en editor móvil → corregido.

## Detalle por etapa

### 00 — Auditoría y bootstrap
- Repo inicial: solo documentación, sin commits. Bootstrap con `create-next-app@16.4.2` (TypeScript estricto, Tailwind 4, ESLint, npm + lockfile). `AGENTS.md` del proyecto protegido (`agentRules: false`).
- Scripts: `dev, build, start, lint, typecheck, test, test:unit, test:integration, test:e2e, db:*, worker, sim:*, bootstrap:admin, verify:restore`.
- `.env.example` exhaustivo sin secretos; `.gitignore` excluye `.env*` (salvo el ejemplo), `storage`, reportes.
- **Skills:** se revisó el origen (github.com/Leonxlnx/taste-skill, MIT, commit 6010f91 del 2026-10-20). Los 5 nombres pedidos (`gpt-taste`, `redesign-existing-projects`, `full-output-enforcement`, `high-end-visual-design`, `image-to-code`) **no existen**; `npx skills add` respondió que solo está `design-taste-frontend`. No se instaló ni ejecutó código de terceros; se usó su guía para pantallas de app como referencia de lectura.
- **Brand audit verificado** en el sitio publicado → `docs/brand-audit.md`.

### 01 — Sistema visual y navegación
- Tokens semánticos en `globals.css` (marca lima/esmeralda real, Inter + Space Grotesk self-hosted), componentes (botón, campos con label/error, badge, avatar, panel, modal `<dialog>`, toast en top layer, estados vacío/error/sin permiso/offline/skeleton).
- Shell: sidebar estrecha + topbar con empresa activa, selector de empresa (validado en servidor), menú de cuenta; drawer en móvil; "Saltar al contenido"; foco visible; `prefers-reduced-motion`.
- Vista `/demo` (solo con `LOOPCHAT_DEMO_MODE=true`) rotulada **DEMO**, desconectada del backend.

### 02 — Multiempresa, auth, datos, RBAC
- PostgreSQL propio + Drizzle (`drizzle/0000_init.sql`, migración versionada). Entidades del modelo conceptual de `context.md` §6.
- Better Auth: email+contraseña (mín. 10), sesiones en DB, reset por email (30 min) con revocación de sesiones, alta solo por invitación (registro público deshabilitado), cookies `Secure` con https.
- Invitaciones con token aleatorio (se guarda solo el hash), 7 días, un solo uso (claim atómico). Cupo de usuarios del plan.
- Contexto de tenant validado contra membresías en cada request; IDs ajenos → 404. Matriz en `docs/permissions-matrix.md`.
- Cifrado AES-256-GCM con AAD por tenant y rotación de claves.
- Tests: `auth-tenancy.test.ts`, `permissions.test.ts`, `vault.test.ts`.

### 03 — Chatwoot
- Código fuente oficial v4.19.0 inspeccionado: rutas, payloads y **firma HMAC real** (`X-Chatwoot-Signature`, `X-Chatwoot-Timestamp`, `X-Chatwoot-Delivery`). Ver `docs/chatwoot-integration.md`.
- Aprovisionamiento por Platform API (cuenta + usuario de servicio + webhook firmado) y vinculación manual verificada.
- Receptor idempotente (dedupe por entrega y por id de mensaje), validación de cuenta cruzada, cola, reconciliación programada.
- `infra/chatwoot/docker-compose.yml` con versión fijada y DB separada.
- Simulador de contrato (`tools/chatwoot-sim`) para pruebas sin Docker/Meta. **No se afirma integración real probada.**

### 04 — Bandeja humana
- Lista paginada con filtros (mías/sin asignar/todas, estado, modo, búsqueda), hilo leído en vivo desde Chatwoot, adjuntos, estados de entrega con evidencia (conciliación por API), reintento sin duplicados, notas internas (solo Loopchat), un único responsable, cambio de estado, pausa/reanudación del bot, ventana de 24 h con bloqueo explicado, polling con backoff y detección offline.
- Tests: `chatwoot-inbox.test.ts` (10), E2E `inbox.spec.ts`, `mobile.spec.ts`.

### 05 — Contactos y pipeline
- Contactos únicos por (empresa, número de canal, E.164); ficha unificada; múltiples oportunidades.
- Pipelines y etapas configurables (reglas: inicial abierta, una ganada, una perdida), plantilla inicial editable, Kanban con drag-and-drop (dnd-kit) + selector "Mover a" accesible, detalle con importe/moneda/responsable/seguimiento/tareas/notas/historial, concurrencia optimista (409 sin pérdida silenciosa), creación rápida desde la bandeja, auto-oportunidad para contactos nuevos (configurable).
- Tests: `pipeline.test.ts`, `aggregates.test.ts`, E2E `pipeline.spec.ts`.

### 06 — IA BYOK y bot básico
- Adaptadores: OpenAI-compatible (Chat Completions), **Anthropic Messages** y **Gemini** nativos; claves cifradas por tenant, nunca devueltas; prueba de conexión; rotación/revocación; SSRF en URL base.
- Bot por instrucciones (compilado a grafo), allowlist de herramientas (clasificar, conocimiento, derivar, oportunidad, etapa, tarea), palabras de derivación, trazabilidad (bot/versión/ejecución en cada mensaje), logs redactados, reintentos acotados y derivación a humano ante falla/timeout/cupo, sin respuestas concurrentes (lock de fila + cancelación de ejecuciones al tomar control).
- Tests: `bots.test.ts` (13), `ai-step.test.ts`.

### 07 — Constructor visual
- React Flow (MIT) con nodos inicio/mensaje/IA/condición/oportunidad/asignar humano/esperar/fin, panel de propiedades, conexiones tipadas, validación determinística en vivo, autoguardado con control de revisión, vista "Lista" como alternativa sin arrastre (teclado/móvil), publicación de versiones inmutables con checksum, simulador que nunca envía mensajes (IA simulada por defecto; real opcional y explícita).
- Runtime: `flow_runs` + pasos persistidos, esperas durables con timeout, reintentos desde el último paso, guarda de pasos máximos, cancelación al pasar a humano.
- Tests: `flow.test.ts`, `bots.test.ts` (flujo de 2 rutas, borrador vs. publicado, pausa), E2E `bots.spec.ts`.

### 08 — Conocimiento y tareas
- FAQ, texto, archivos TXT/MD/PDF (≤ 5 MB, extensión + verificación de contenido, PDF sin texto → falla explícita, sin OCR), almacenamiento segregado por tenant, full-text en español acotado al tenant, eliminación.
- Tareas con responsable/vencimiento/vínculo a contacto u oportunidad, creadas también por el bot.
- Tests: `knowledge-tasks.test.ts`.
- Horario de atención por empresa (Configuración → Empresa) disponible en flujos como variable `horario` (`abierto`/`cerrado`). Exportación CSV de contactos y oportunidades (admins, auditada).

### 09 — Onboarding y configuración
- Panel Loop Smiths: alta de empresa con plan e invitación, aprovisionamiento Chatwoot, invitar usuarios. Configuración guiada de WhatsApp (WABA, Phone Number ID, token, confirmación de facturación propia), verificación de solo lectura en Graph API, vínculo con bandeja Chatwoot, rotación, desconexión segura. Equipo/roles, IA, pipeline, conocimiento, empresa, auditoría. Impersonación deshabilitada.

### 10 — Planes y cuotas
- Starter/Growth/Pro editables, estados de suscripción, cambio inmediato y auditado, cuotas en backend y worker (atómicas e idempotentes), suspensión = solo lectura, consumo visible.
- Tests: `quota-subscription.test.ts` (concurrencia incluida).

### 11 — Dashboard y operación
- Métricas trazables por tenant y período con cobertura declarada; pendientes accionables; health checks; logs estructurados redactados; reconciliación y reprocesamiento; retención; runbook (`docs/operations.md`).

### 12 — QA integral
- Ver `docs/qa-final.md`.

### 13 — Ship
- Ver `docs/qa-final.md` y `docs/deployment.md`. Estado: **no SHIPPED** (falta despliegue autorizado y pruebas reales).
