# 05 — Rendimiento e infraestructura

**2026-11-04 · commit `ecbf4e2`**

## 1. Entorno de medición (importante para interpretar los números)

- Equipo local: AMD Ryzen 5 3600X (6 núcleos / 12 hilos), 17 GB RAM, Windows 10.
- PostgreSQL **17.5 embebido** (paquete `embedded-postgres`, binarios oficiales) en el mismo equipo — Docker Desktop no arrancó; el proyecto apunta a PG 16 (sin diferencias funcionales observadas: 209/209 tests en verde).
- App: build de producción (`next build` + `next start`, un proceso), datos DEMO pequeños (2 empresas, decenas de filas).
- Chatwoot e IA: **simuladores** locales; no hay Chatwoot real (Rails + Sidekiq + Redis) en estas mediciones.
- Todo comparte CPU con el cliente de carga. Los números son **cotas optimistas** de la capa Loopchat, no del sistema completo.

## 2. Mediciones reales

### 2.1 API de lectura (build de producción) — `tests/audit/load.audit.mjs`

Mezcla de 6 endpoints (conversaciones, tablero, métricas, contactos, bots, health), sesiones de 2 empresas:

| Concurrencia | Requests | Errores | req/s | p50 ms | p95 ms | p99 ms | máx ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 120 | 0 | 60 | 16 | 28 | 29 | 29 |
| 10 | 600 | 0 | 335 | 26 | 56 | 72 | 84 |
| 25 | 1000 | 0 | 382 | 59 | 116 | 136 | 168 |
| 50 | 1500 | 0 | 396 | 117 | 217 | 255 | 306 |

Saturación ≈ 400 req/s en un proceso. Con polling de la UI (lista cada 5 s + hilo cada 4 s ≈ 0,45 req/s por agente activo), un proceso aguanta en teoría cientos de agentes conectados **con datos pequeños**; con tablas grandes no se midió (sin índices bajo volumen probado).

### 2.2 Motor de mensajes (harness, worker real, IA simulada con 150 ms)

| Medición | Resultado |
|---|---|
| 40 webhooks firmados simultáneos (5 empresas × 8 conversaciones) — ingesta | 327–398 ms total (receptor + dedupe + encolado) |
| Drenaje de la cola con **1 worker** hasta responder las 40 | 13,6–14,2 s (≈ 340–355 ms por conversación, **secuencial**) |
| Respuestas entregadas | 40/40 |
| RSS del proceso de pruebas | ~130–140 MB |
| Empresa B detrás de 3 llamadas de IA de 1,5 s de la empresa A | **5,5 s** de espera para B (debería ser ≈ su propia latencia) |

### 2.3 Cuello de botella principal (PERF-01, CONFIRMADO)

`src/server/jobs/worker.ts` reclama lotes de 10 pero los procesa **uno por uno** (`for … await handle(job)`); `scripts/worker.ts` es un único bucle. Throughput del motor ≈ 1 / (latencia de IA + overhead). Con IA real típica de 2–6 s por turno (más el clasificador en equipos):

| Latencia por turno | Turnos/min con 1 worker | Mensajes/hora |
|---|---:|---:|
| 2 s | ~30 | ~1.800 |
| 5 s | ~12 | ~720 |
| 10 s (timeouts/reintentos) | ~6 | ~360 |

Y lo más grave: **no hay equidad entre empresas**; un pico de una empresa o un proveedor lento retrasa a todas. Además el lock del job es de 120 s con lotes de 10: si 10 turnos lentos superan 120 s, otro worker podría re-tomar trabajos aún en curso (riesgo de doble ejecución con varios workers, ver 04/AI F1).

## 3. Infraestructura existente (revisada)

| Componente | Estado | Observaciones |
|---|---|---|
| `infra/loopchat/docker-compose.yml` | Existe | app + worker + Postgres 16; app ligada a 127.0.0.1 detrás de proxy TLS; healthcheck |
| `infra/loopchat/Dockerfile` | Existe | Multi-stage, usuario no root; copia **todo** `/app` (incluye devDependencies y fuentes) → imagen grande; `npm start` sin `output: standalone` |
| `infra/chatwoot/docker-compose.yml` | Existe | Chatwoot v4.19 fijada, Postgres (pgvector) + Redis con contraseña + Sidekiq; Rails ligado a 127.0.0.1 |
| Proxy TLS (Caddy) | Documentado en `docs/deployment.md` | No probado |
| Backups | `scripts/backup.sh` / `restore.sh` / `verify:restore` | **Manuales**; sin cron, sin copia externa, sin cifrado; Chatwoot se respalda aparte (documentado) — OPS-01 |
| Monitoreo | `/api/health`, logs JSON redactados, panel de operaciones | **Sin** métricas, alertas, uptime externo ni seguimiento de errores — OPS-02 |
| Recuperación | Locks vencidos se retoman; reproceso idempotente de eventos; reconciliación cada 15 min | Reconciliación solo revisa 2 páginas (≈50 conversaciones) por cuenta |
| CI/CD | **No existe** | OPS-03 |
| Retención | Purga de payloads de webhooks > 30 días | Sin política de retención de mensajes/archivos declarada públicamente |

## 4. VPS 4 vCPU / 8 GB para Chatwoot — análisis (capacidad TEÓRICA, no medida)

Consumo de referencia de Chatwoot CE (documentación oficial y experiencia de la comunidad; **no medido en esta auditoría**): Rails (Puma) 0,5–1 GB, Sidekiq 0,5–1 GB, PostgreSQL 0,5–2 GB según volumen, Redis 50–200 MB. Requisito mínimo publicado por Chatwoot: 4 GB RAM para instalaciones pequeñas.

Si Loopchat (web + worker + su Postgres) comparte el mismo VPS: Next.js ~200–400 MB por proceso, worker ~150–250 MB, Postgres de Loopchat 0,3–1 GB.

| Escenario | Supuesto de uso | ¿4 vCPU / 8 GB alcanza? | Condiciones |
|---|---|---|---|
| 1 empresa | ≤ 5 agentes, ≤ 1.000 conv/mes, 1 bot | Sí, holgado | Backups automáticos; swap configurada |
| 5 empresas | ≤ 25 agentes, ≤ 5.000 conv/mes | Probablemente sí en memoria/CPU | **Requiere corregir PERF-01** (worker concurrente); separar Postgres de Chatwoot y Loopchat con límites de memoria; monitoreo |
| 10 empresas | ≤ 50 agentes, ≤ 10.000 conv/mes, picos simultáneos | Ajustado; depende de picos | Worker concurrente con equidad por empresa; 2 procesos web; Postgres afinado; mover Loopchat a otro VPS o aumentar a 8 vCPU/16 GB si hay picos |
| 20 empresas | ≤ 100 agentes, ≤ 20.000 conv/mes | **No recomendable** en un único VPS de 4/8 | Separar Chatwoot y Loopchat en hosts distintos; Postgres gestionado o dedicado; prueba de carga previa obligatoria |

**No se puede afirmar** un número de empresas soportado sin: Chatwoot real bajo carga, IA real con su latencia, y datos de volumen (miles de conversaciones por empresa). Lo único medido es que la capa HTTP de Loopchat no es el cuello de botella a esta escala; el motor de bots sí lo es hoy.

## 5. Requisitos mínimos de infraestructura para un piloto

1. Worker concurrente con equidad por empresa (P0-03).
2. Backups diarios automáticos de ambas bases + `storage`, copia externa cifrada, restore probado.
3. Monitoreo: uptime externo de `/api/health` y Chatwoot, alertas por profundidad de cola (`jobs` queued > N o antigüedad > 60 s), jobs `failed`, errores 5xx, disco > 80 %, memoria.
4. Límite de cuerpo en el proxy (mitiga SEC-03) y HSTS.
5. Prueba de carga en staging con Chatwoot real (20 empresas simuladas, IA con latencia real) antes de pasar de 5 clientes.
