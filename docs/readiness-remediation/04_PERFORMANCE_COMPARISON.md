# 04 — Rendimiento: antes y después

**Entorno (igual en ambas mediciones):** Windows 10, Ryzen 5 3600X (6/12), 17 GB RAM compartidos con otras aplicaciones del usuario, PostgreSQL 17 embebido, Node 24. Números locales: indican tendencia, no capacidad de producción.

## Motor de mensajes (harness, IA guionada)

| Medición | Antes (`ecbf4e2`) | Después | Cambio |
|---|---:|---:|---|
| 40 conversaciones simultáneas (5 empresas, IA 150 ms): tiempo hasta responder todas | 13,6–14,2 s | **2,8 s** | ≈ 5× más rápido (pool de 8, equidad por empresa) |
| Empresa B detrás de 3 llamadas lentas (1,5 s) de la empresa A | 5,5 s | **1,8 s** (harness) / **< 1,5 s** (test de integración) | B ya no espera la cola de A |
| Respuestas perdidas en ráfaga (S24) | 1 de 2 mensajes ignorado | 0 | sin pérdidas |
| Duplicados con 2 workers sobre la misma ejecución | posibles (claim sobre `running`) | 0 (1 llamada a IA, 1 respuesta) | leases + fencing |
| Llamadas de IA por reintento tras falla de Chatwoot | 2 (2 facturadas) | 1 | generación reutilizada |
| Memoria del proceso de pruebas | ~130–140 MB | ~138 MB | sin cambio relevante |

## API HTTP (build de producción, `tests/audit/load.audit.mjs`)

| Concurrencia | Antes req/s · p95 | Después req/s · p95 | Errores |
|---:|---|---|---:|
| 1 | 60 · 28 ms | 58 · 28 ms | 0 |
| 10 | 335 · 56 ms | 356 · 53 ms | 0 |
| 25 | 382 · 116 ms | 409 · 108 ms | 0 |
| 50 | 396 · 217 ms | 438 · 197 ms | 0 |

Sin regresión por los nuevos controles (suspensión en cada escritura, IP de proxies, límites de cuerpo). Diferencias dentro del ruido de un equipo compartido.

## Sistema completo con Chatwoot real (nuevo)

`tests/audit/chatwoot-real.audit.test.ts` contra Chatwoot CE **4.19.0 real** en Docker (rails + sidekiq + postgres + redis), bandeja API (sin Meta):

| Medición | Resultado |
|---|---|
| 24 mensajes entrantes simultáneos (4 empresas × 6 conversaciones), webhook firmado real → Loopchat → bot (IA guionada 300 ms) → API de Chatwoot | **24/24 respondidas**, 6,4 s en total |
| Latencia mensaje → respuesta visible en Chatwoot | p50 5,9 s · p95 6,3 s — **cota superior**: incluye el sondeo secuencial del test (24 GET por vuelta + `settle`), no solo el sistema |
| Memoria de Chatwoot en reposo | rails 438 MB · sidekiq 441 MB · postgres 82 MB · redis 6 MB (≈ 1,0 GB) |
| Memoria de Chatwoot tras la prueba funcional | sidekiq 531 MB · rails 436 MB · postgres 106 MB (≈ 1,1 GB) |

## Límite de cuerpos (build de producción)

| Medición | Antes | Después |
|---|---|---|
| POST chunked de 50 MB al webhook público | leído completo, 413 a los 2.020 ms | **413 a los 121 ms**, ≤ 512 KB leídos |

## Viabilidad del VPS de 4 vCPU / 8 GB (estimación con supuestos, no medición del sistema completo en producción)

Base medida: Chatwoot ≈ 1,0–1,1 GB con carga baja; Loopchat (web + worker) ≈ 0,3–0,5 GB; PostgreSQL de Loopchat 0,1–0,5 GB. El cuello de botella del motor dejó de ser el worker: ahora domina la latencia del proveedor de IA de cada cliente (BYOK) y Sidekiq de Chatwoot.

| Escenario | Supuesto | ¿4 vCPU / 8 GB? | Condiciones |
|---|---|---|---|
| 1 empresa | ≤ 5 agentes, ≤ 1.000 conv/mes | Sí | Backups + monitor activos |
| 5 empresas | ≤ 25 agentes, ≤ 5.000 conv/mes | Sí, con margen | `WORKER_CONCURRENCY=8`, `WORKER_TENANT_CONCURRENCY=2`; límites de memoria por contenedor |
| 10 empresas | ≤ 50 agentes, picos simultáneos | Probable | Medir en staging con Meta e IA reales; Sidekiq de Chatwoot es el primer candidato a saturar |
| 20 empresas | ≤ 100 agentes | **No afirmado** | Requiere prueba de carga real; probablemente separar Chatwoot y Loopchat |

Pendiente para afirmar capacidad: prueba con Meta real (entregas, plantillas) e IA real (latencias de 2–10 s), y observación de CPU/memoria del VPS durante una semana de piloto.
