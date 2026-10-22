# QA final — Loopchat V1

**Fecha:** 2026-10-21 · **Resultado:** `VERIFIED_LOCAL` + `BLOCKED_EXTERNAL`. **No `SHIPPED`**: no hubo despliegue autorizado ni prueba con Meta, Chatwoot e IA reales.

## 1. Suite ejecutada (entorno Linux, Node 22, PostgreSQL 16, Chromium 1194)

| Comando | Resultado |
|---|---|
| `npm run lint` | ✅ 0 errores, 0 advertencias |
| `npm run typecheck` | ✅ 0 errores |
| `npm run test` (Vitest: unit + integración con PostgreSQL real y simuladores) | ✅ 13 archivos, 83 tests |
| `npm run test:e2e` (Playwright: setup + escritorio 1440 + móvil 390 + accesibilidad) | ✅ 18/18 (ver §1.1) |
| `npm run build` (producción) | ✅ sin errores ni advertencias |
| `npm audit --omit=dev` | ⚠️ 4 moderadas en `esbuild` vía `drizzle-kit` (herramienta de migraciones; afecta el *dev server* de esbuild, que Loopchat no usa). Sin vulnerabilidades en dependencias de runtime de la app. `npm audit` completo agrega `braces` (tooling de ESLint). Sin fix compatible publicado; revisar en cada release. |
| Licencias de producción | ✅ MIT/ISC/Apache/BSD/OFL; LGPL solo en `sharp-libvips` (dependencia opcional de Next, enlace dinámico); MPL-2.0 en `lightningcss` (build). Chatwoot CE: MIT fuera de `enterprise/` (no se usa). React Flow: MIT (atribución visible). |

### 1.1 E2E (Playwright)

| Spec | Qué prueba |
|---|---|
| `global.setup.ts` | Base E2E reproducible: esquema desde migraciones, datos DEMO, conexión a simuladores, bot respondiendo 4 conversaciones |
| `auth.spec.ts` | Redirección a login, credenciales inválidas, teclado ("Saltar al contenido"), logout invalida sesión, **alta de empresa por Loop Smiths → invitación → cuenta nueva → dashboard** |
| `inbox.spec.ts` | Respuesta del bot visible; respuesta humana sale **una sola vez** por Chatwoot y pausa el bot; nota interna **nunca** sale; mensaje nuevo aparece por polling; **aislamiento A/B por URL/API (404 sin filtrar datos)**; solo lectura no responde; CSRF (403) |
| `pipeline.spec.ts` | Mover con selector accesible (sin arrastre) y persistencia; detalle (importe, tarea, historial); solo lectura sin controles |
| `bots.spec.ts` | Crear flujo, vista Lista, validación en vivo, publicar v1, **simular sin enviar nada** (estado del simulador idéntico), versiones; clave de IA nunca vuelve al navegador |
| `mobile.spec.ts` (390 px) | Bandeja → conversación → ficha → responder → volver; páginas sin overflow; menú lateral |
| `a11y.spec.ts` | axe-core WCAG 2.1 A/AA: **0 violaciones serias o críticas** en login y 9 vistas + conversación abierta |

## 2. Criterios de `context.md` §8 (Definition of Done)

| Criterio | Estado | Evidencia |
|---|---|---|
| Funciona localmente con servicios documentados y despliegue reproducible | ✅ local / ⏳ despliegue no ejecutado | README, `docs/deployment.md`, `infra/` |
| E2E autenticado A/B, aislamiento positivo y negativo en API, UI y eventos/colas; sin secretos expuestos | ✅ | `auth-tenancy`, `chatwoot-inbox` (cuenta cruzada, firma), `bots` (A/B credenciales), `knowledge` (búsqueda por tenant), `inbox.spec` |
| Mensajes reales Meta→Chatwoot→Loopchat→respuesta | **BLOCKED_EXTERNAL** — reemplazado por modo de integración reproducible con simulador de contrato (firma real v4.19) | `tools/chatwoot-sim`, tests de integración y E2E |
| Contactos, pipeline, notas, responsables, bot→humano con persistencia real | ✅ | integración + E2E |
| Bot básico y editor visual con reglas reales y simulador; ≥ 2 adaptadores IA | ✅ con simulador de proveedores (OpenAI-compatible, Anthropic, Gemini). **Real: BLOCKED_EXTERNAL** | `bots.test.ts`, `flow.test.ts`, `ai-step.test.ts`, `bots.spec.ts` |
| Suscripciones y cuotas restringen escrituras/ejecuciones; panel; cambios auditados | ✅ (incluye concurrencia) | `quota-subscription.test.ts`, `bots.test.ts` |
| Lint, typecheck, unit, integración, E2E, build, revisión visual y seguridad crítica; operación, backups, restore y variables documentados | ✅ | §1, §3–§6, `docs/operations.md` |

## 3. Seguridad (verificado)

- **Aislamiento:** contexto de tenant validado contra membresías en cada request; toda consulta filtra `tenant_id`; IDs ajenos → 404 (tests negativos en servicios, API y UI). Admins de otra empresa tampoco acceden. Platform admin sin acceso a conversaciones.
- **Webhooks:** HMAC-SHA256 real de Chatwoot, ventana de 5 min, cuenta del evento = cuenta mapeada, clave opaca en la URL, dedupe; sin firma → rechazo.
- **CSRF:** mutaciones exigen `Origin` igual a la app (403 en otro origen o sin origen; probado en producción local). Cookies de sesión `HttpOnly`, `SameSite=Lax`, `Secure` con https.
- **Rate limits:** login 8/min y reset 4/min por IP (Better Auth, activo en producción; verificado 429 al 8.º intento), aceptación de invitaciones, envío de mensajes, pruebas de IA, subida de archivos, exportación.
- **Secretos:** AES-256-GCM con AAD por tenant, nunca devueltos (solo `••••1234`), logs redactados; `verify:restore` comprueba que los secretos restaurados se descifran.
- **SSRF:** URL base de proveedores IA solo https y sin redes privadas/metadata en producción; la app no arranca con `LOOPCHAT_ALLOW_PRIVATE_URLS=true` en producción.
- **Archivos:** extensión + verificación de contenido (firma PDF, UTF-8 sin NUL), 5 MB, nombre en disco generado, carpeta por tenant, sin OCR; PDF escaneado → falla explícita.
- **XSS:** sin `dangerouslySetInnerHTML`; adjuntos solo `http(s)` con `rel="noopener noreferrer"`. Encabezados `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Prompt injection / abuso de bots:** reglas de plataforma no editables, conocimiento delimitado como datos, salida JSON con allowlist validada en servidor, máximo de pasos, bucles sin espera rechazados, cuota de IA.
- **Política Meta:** mensaje libre bloqueado fuera de 24 h con explicación; un único camino de salida (Chatwoot).
- **CSV:** neutralización de fórmulas.
- Sin `TODO/FIXME` ni secretos en el repositorio (búsqueda automatizada).

## 4. Rendimiento medido (build de producción local, datos DEMO pequeños)

| Ruta | TTFB promedio (3 muestras) |
|---|---|
| `/dashboard` (primera carga incluye compilación de consultas) | 149 ms (máx. 351 ms) |
| `/conversaciones`, `/pipeline`, `/contactos`, `/chatbots` | 23–35 ms |
| `GET /api/v1/conversations`, `/api/v1/board`, `/api/v1/metrics` | 12–20 ms |

Paginación de 30 conversaciones con cursor, polling con backoff (5 s lista, 4 s hilo, pausa con pestaña oculta). **No se establecen SLA**: no hubo prueba de carga ni volumen real.

## 5. Responsive y accesibilidad

- Capturas en `docs/evidence/` (1440/768/390): dashboard, bandeja (3 columnas → pantallas navegables en móvil), pipeline (scroll horizontal acotado al tablero), contactos, editor de flujos (lienzo / vista lista), configuración WhatsApp e IA, plan, panel Loop Smiths. Sin overflow horizontal global en ninguna (verificado programáticamente).
- Teclado: "Saltar al contenido", foco visible, drag-and-drop con alternativa por selector, editor con vista lista, `<dialog>` modales con Esc.
- axe-core sin violaciones serias/críticas; contraste de tokens ≥ 4,5:1 en textos; `prefers-reduced-motion`.

## 6. Backups y restore (probado)

Comandos: `DATABASE_URL=… scripts/backup.sh /backups` → `createdb loopchat_restore` → `TARGET_DATABASE_URL=… scripts/restore.sh <dump>` → `RESTORE_DATABASE_URL=… npm run verify:restore`.


`scripts/backup.sh` → `pg_dump` custom; `scripts/restore.sh` en base temporal `loopchat_restore`; `npm run verify:restore`: conteos idénticos (3 empresas, 5 conversaciones, 9 mensajes, 5 oportunidades, 2 versiones de bot) y **8/8 secretos descifrables**. Recuperación ante cola caída: los trabajos con lock vencido se retoman automáticamente; eventos fallidos se reprocesan desde el panel (idempotente).

## 7. Pruebas NO ejecutadas (y por qué)

| Prueba | Motivo | Qué hace falta |
|---|---|---|
| Chatwoot CE real (Docker) | Docker Hub bloqueado en el entorno del agente | Correr `infra/chatwoot` en VPS o PC con Docker |
| Meta WhatsApp Cloud API real | Sin WABA/número/token del cliente | Activos Meta de una empresa piloto |
| Proveedores IA reales | Sin claves | Una clave de OpenAI (o compatible) y una de Anthropic o Gemini |
| SMTP real | Sin servidor SMTP | `SMTP_URL` de un proveedor transaccional |
| Despliegue en VPS con TLS | Requiere contratar y autorizar | VPS + dominio |
| Prueba de carga | Fuera del alcance local | Entorno de staging |

## 8. Checklist de validación real (para declarar `VERIFIED_REAL` / `SHIPPED`)

1. Chatwoot CE v4.19 levantado; Platform App creada; `CHATWOOT_*` en Loopchat.
2. En `/admin`: crear empresa piloto → **Aprovisionar cuenta** → verificar en Chatwoot que existe la cuenta y el webhook "Loopchat" con secreto.
3. Admin del cliente: conectar número (WABA, Phone Number ID, token permanente). Esperado: estado **Conectado**; bandeja creada en Chatwoot.
4. En Meta: webhook de WhatsApp → `https://chatwoot…/webhooks/whatsapp/<número>` con el verify token de la bandeja; suscripción `messages`.
5. Desde un teléfono real escribir al número → la conversación aparece en Loopchat (≤ 10 s) con contacto y oportunidad.
6. Responder desde Loopchat → llega al teléfono; estados enviado → entregado → leído visibles.
7. Nota interna → no llega al teléfono.
8. Conectar IA real (dos proveedores, uno a la vez), probar conexión, activar bot por instrucciones → el bot responde; pedir "humano" → deriva y deja de responder; reanudar.
9. Publicar un flujo con espera → responder → continúa.
10. Esperar > 24 h sin mensajes del cliente → el envío libre queda bloqueado con explicación.
11. Revocar la clave de IA → el bot deriva a humano sin responder dos veces.
12. Backup y restore en base temporal + `verify:restore`.

## 9. Riesgos y límites conocidos

- Integración con Chatwoot probada contra un **simulador de contrato** construido a partir del código fuente oficial; diferencias de comportamiento en runtime real (p. ej. tiempos de Sidekiq, validaciones de Meta al crear bandejas) solo se detectan en el paso 2–6 del checklist.
- Envío de **plantillas** fuera de la ventana: en V1 se hace desde la UI de Chatwoot por un administrador; Loopchat bloquea e informa.
- Envío de adjuntos desde Loopchat: no incluido (sí se visualizan los recibidos).
- Un único worker recomendado; varios workers son seguros (SKIP LOCKED) pero no se probaron bajo carga.
- Polling (no websockets) para tiempo real: adecuado para pocos agentes; medir con uso real.
- Impersonación/soporte con acceso temporal: deshabilitado en V1.
