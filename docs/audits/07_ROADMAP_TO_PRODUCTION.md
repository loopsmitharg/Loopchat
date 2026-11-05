# 07 — Roadmap a producción

**2026-11-04 · commit `ecbf4e2`**
Esfuerzo expresado en días-persona de un desarrollador senior que ya conoce el código (rango orientativo). IDs de hallazgos: `SEC-*` (03), `AI-*`/`S*`/`F*` (04), `PERF-*`/`OPS-*` (05).

## 1. Registro de problemas

### P0 — Bloqueantes (impiden operar de forma segura o cumplir una función esencial)

| ID | Título | Módulo | Ubicación | Evidencia | Impacto | Solución | Criterio de cierre | Esfuerzo |
|---|---|---|---|---|---|---|---|---|
| P0-01 | Flujo real Meta → Chatwoot → Loopchat nunca validado | Integración | `src/server/chatwoot/*`, `infra/chatwoot` | Solo simulador de contrato; `qa-final.md §7` | Sin esto no hay producto | Levantar Chatwoot CE v4.19 en VPS de staging, conectar un número de prueba de Meta, ejecutar checklist `qa-final.md §8` | Los 12 pasos del checklist con evidencia (capturas + logs) | 3–6 d (más espera de Meta) |
| P0-02 | Mensajes del cliente descartados mientras el bot procesa | Motor de bots | `src/server/flows/trigger.ts` (`reason: "busy"`) | S24: pedido de "asesor" ignorado | Clientes sin respuesta, pedidos de humano/insultos ignorados | Encolar el mensaje (cola por conversación o re-disparo al terminar la ejecución) y evaluar palabras clave/insultos de **cada** mensaje antes de descartarlo | S24 PASS: el 2º mensaje con palabra clave deriva; 2 mensajes de pregunta reciben respuesta que considera ambos | 2–4 d |
| P0-03 | Worker secuencial: bloqueo entre empresas | Cola | `src/server/jobs/worker.ts` | S48: 5,5 s de espera por IA lenta de otra empresa; 40 conv. drenadas en 14 s | Una empresa degrada a todas; con IA a 5–20 s colapsa con pocos clientes | Concurrencia por trabajo (p. ej. N=8 en paralelo con `Promise.all` acotado) + varios procesos worker; equidad por tenant; lock de job > timeout máximo | S48 < 2 s; prueba de 20 empresas con IA de 3 s sin trabajos > 10 s en cola | 2–3 d |
| P0-04 | Prueba con proveedores de IA reales nunca ejecutada | IA | `src/server/ai/*` | Solo simulador | Cambios de contrato/parámetros (p. ej. `max_completion_tokens`) solo aparecen en real | Clave de prueba con tope de gasto; ejecutar escenarios de 04 §6 | 0 fallas de contrato; métricas de tokens reales | 1–2 d |

### P1 — Críticos para comercializar

| ID | Título | Ubicación | Evidencia | Solución | Criterio | Esfuerzo |
|---|---|---|---|---|---|---|
| P1-01 | Salida malformada enviada al cliente | `src/server/flows/ai-step.ts` `parseAiDecision` | F5 | Si no parsea: reintento único con instrucción de formato o derivación; nunca enviar texto que empiece con `{`; verificar `stop_reason`/`finish_reason` en Anthropic/OpenAI | F5 PASS | 0,5–1 d |
| P1-02 | Reintentos re-llaman a la IA y duplican tareas/consumo | `runtime.ts` (`${key}:a${attempt}`), `tasks.ts` | F4: 2 tareas, 2 IA | Persistir la decisión del turno antes de enviar; en reintento reutilizarla; clave idempotente para tareas/oportunidades por `runId+nodo` | F4: 1 tarea, 1 llamada IA | 1–2 d |
| P1-03 | Efectos CRM tras toma humana | `ai-turn.ts` (acciones post-llamada) | S22 | Revalidar `stillInControl` dentro de la transacción que aplica acciones | S22 PASS | 0,5–1 d |
| P1-04 | SSRF por IPv6 mapeada / DNS | `src/server/http/ssrf.ts` | SEC-02 | Resolver DNS + validar todas las IPs + fijar IP | `ssrf.audit.test.ts` sin bypass | 1 d |
| P1-05 | Lectura de cuerpo sin límite (webhook público) | `webhooks/chatwoot/[key]/route.ts`, `http/api.ts` | SEC-03 | Lectura por stream con tope; límite en proxy | 50 MB chunked → 413 sin leer >600 KB | 0,5–1 d |
| P1-06 | Nombre de contacto en prompt de sistema | `ai-step.ts` | S34b / SEC-04 | Sanitizar y rotular como dato | S34b PASS | 0,5 d |
| P1-07 | Sin validación de precios/descuentos en la respuesta | `ai-turn.ts` | S6 | Validador post-respuesta: importes y % deben coincidir con catálogo/políticas; si no, regenerar o derivar | S6 PASS en simulado + 0 descuentos inventados con IA real | 2–3 d |
| P1-08 | Catálogo no considera el contexto de la conversación | `ai-turn.ts` `searchCatalog` | S4b | Buscar con los últimos N mensajes + productos de la oportunidad abierta | S4b PASS | 0,5–1 d |
| P1-09 | Sin límite por conversación por defecto / sin rate limit por contacto | `bot-config.ts` (`maxAiCallsPerConversation: 0`) | código | Default razonable (p. ej. 30) + tope por contacto/hora | 50 mensajes de un contacto no superan el tope | 0,5 d |
| P1-10 | Rate limits de login en memoria; IP de `X-Forwarded-For` sin proxy de confianza | `auth/index.ts`, `http/api.ts` | SEC-06 | Storage compartido; IP desde proxy confiable | 429 consistente con 2 instancias | 1 d |
| P1-11 | Backups no automatizados ni externos; sin monitoreo/alertas | `scripts/backup.sh`, `docs/operations.md` | OPS-01/02 | Cron diario + copia off-site cifrada + restore mensual probado; uptime + alertas de cola/errores | Restore probado desde copia remota; alerta disparada en prueba | 2–3 d |
| P1-12 | Sin CI | — | no existe `.github/` | Pipeline: lint, typecheck, test, e2e, audit, SAST (Semgrep), gitleaks | PR bloqueado si falla | 1–2 d |
| P1-13 | Envío de plantillas fuera de ventana desde Loopchat | inbox | `qa-final.md §9` | Selector de plantillas aprobadas vía API de Chatwoot | Reabrir conversación >24 h desde Loopchat | 2–4 d |
| P1-14 | Suspensión de empresa no aplica a todas las escrituras | `authz/context.ts` | SEC-08 | Política única en el contexto | test: empresa suspendida → 403/423 en toda escritura | 0,5 d |

### P2 — Importantes

| ID | Título | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|
| P2-01 | Sin RLS (defensa en profundidad) | SEC-01 | RLS por `app.tenant_id` o test de rutas cruzadas en CI | 3–5 d (RLS) / 1 d (test) |
| P2-02 | Deshabilitar miembro revoca sesiones en todas las empresas | SEC-05 | Revocar solo acceso a la empresa | 0,5 d |
| P2-03 | Historial silenciosamente vacío si Chatwoot falla | `runtime.ts conversationHistory` | Reintentar o derivar | 0,5 d |
| P2-04 | Camino "cotización" mueve etapa sin permiso | AI-12 | Exigir `update_stage` y `allowedStageIds` | 0,5 d |
| P2-05 | Doble ejecución posible con varios workers (`claimable` incluye `running`) | AI F1 | Lease con dueño/expiración; índice único parcial de ejecución activa por conversación | 1 d |
| P2-06 | CSP y HSTS ausentes | SEC-11 | CSP estricta + HSTS (proxy) | 1 d |
| P2-07 | Open redirect en login (hipótesis) | SEC-07 | Validar origen | 0,25 d |
| P2-08 | Adjuntos salientes de agentes | `qa-final.md §9` | Subida → Chatwoot | 1–2 d |
| P2-09 | Validación antes que autorización; IDs malformados → 500 | SEC-09/10 | Orden y validación UUID | 0,5 d |
| P2-10 | Tiempo real por polling | — | Medir; SSE si hace falta | 2–3 d |
| P2-11 | Autoinvitación de platform admin | SEC-12 | Aprobación del tenant o acceso temporal | 1 d |
| P2-12 | Typecheck se rompe con caché `.next/dev` corrupta (el script incluye tipos generados) | `tsconfig.json` | Excluir `.next/dev` o limpiar antes de `tsc` | 0,25 d |

### P3 — Mejoras futuras
Fusión manual de contactos; cuota de almacenamiento; analítica de calidad de bots; acceso de soporte temporal auditado; comparación funcional verificable con Kommo.

## 2. Plan por fases

**Fase A — Seguridad bloqueante (≈ 4–6 d)**
P1-04 SSRF → P1-05 límites de cuerpo → P1-06 nombre en prompt → P1-10 rate limits → P1-14 suspensión → P2-07 redirect. Agregar `http-tenancy.audit.mjs` y `ssrf.audit.test.ts` a CI (P1-12).

**Fase B — Funcionalidad esencial (≈ 6–12 d, incluye esperas externas)**
P0-01 staging con Chatwoot + Meta real (iniciar ya: la aprobación de Meta tiene demoras) → P1-13 plantillas → P2-08 adjuntos salientes.

**Fase C — IA y automatizaciones (≈ 6–10 d)**
P0-02 mensajes concurrentes → P1-02 idempotencia de reintentos → P1-03 control tras toma humana → P1-01 salida malformada → P1-07 validador de precios/descuentos → P1-08 catálogo con contexto → P1-09 límites por conversación → P2-03, P2-04 → P0-04 prueba con IA real.

**Fase D — Estabilidad y rendimiento (≈ 3–5 d)**
P0-03 worker concurrente con equidad → P2-05 lease de ejecuciones → prueba de carga en staging (20 empresas, IA real con latencia típica) → P2-10 si el polling no escala.

**Fase E — Infraestructura y producción (≈ 4–6 d)**
P1-11 backups automáticos off-site + monitoreo/alertas (uptime, profundidad de cola, jobs fallidos, errores 5xx, disco) → P1-12 CI completo → P2-06 CSP/HSTS → runbook de incidentes probado → P2-01 RLS o test exhaustivo.

**Fase F — Validación final (≈ 3–5 d)**
Repetir: suite completa, harness de auditoría (objetivo 50/50), E2E, checklist real de 12 pasos, pentest externo acotado, piloto con 1 cliente durante 2 semanas con monitoreo.

## 3. Total orientativo
- Hasta **piloto controlado con 1–2 clientes**: Fases A + B (P0-01) + C (P0-02, P1-01..03, P1-06) + D (P0-03) ≈ **15–25 días-persona** + espera de Meta.
- Hasta **producción comercial general**: todas las fases ≈ **30–45 días-persona**.
- Factores que alteran la estimación: diferencias reales Chatwoot/Meta vs. simulador (riesgo principal), tiempos de verificación de Meta Business, calidad real de los modelos elegidos frente a reglas comerciales, hosting elegido.
