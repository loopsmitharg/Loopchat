# 06 — Puntuación de preparación

**2026-11-04 · commit `ecbf4e2`**

## 1. Notas por área

| Área | Peso | Nota | Ponderado |
|---|---:|---:|---:|
| Funcionalidad del CRM y WhatsApp | 20 % | **6** | 1,20 |
| Chatbots, IA y multiagente | 25 % | **6** | 1,50 |
| Seguridad y aislamiento multiempresa | 25 % | **7** | 1,75 |
| Estabilidad, pruebas y rendimiento | 15 % | **6** | 0,90 |
| Infraestructura y preparación comercial | 15 % | **4** | 0,60 |
| **Total** | | | **5,95 ≈ 6,0 / 10** |

**Restricciones aplicadas:** no hay vulnerabilidad crítica de aislamiento (el tope de 5 no aplica); el flujo de WhatsApp nunca se validó con Meta real (tope de 7, no condiciona porque el total es menor); autenticación y permisos **sí** se verificaron con pruebas (HTTP y tests); hay módulos esenciales con defectos (mensajes concurrentes, worker secuencial) que bajan las notas de CRM/IA/estabilidad.

**Interpretación:** 5–6 = *MVP parcial, no preparado para clientes reales*. Es un MVP parcial **avanzado**: el código y los controles de servidor son de buena calidad; lo que falta es validación real y corregir defectos de concurrencia del motor.

## 2. Justificación con evidencia

### CRM y WhatsApp — 6
- **A favor (verificado):** contactos E.164 sin duplicados, pipelines configurables con historial y concurrencia optimista, oportunidades, tareas, notas internas, un único responsable, ventana de 24 h, idempotencia de envíos y webhooks (209 tests en verde; E2E 25/26 + 1 flaky que pasa aislado; S39).
- **En contra:** **0 % validado con Meta y Chatwoot reales**; mensajes del cliente descartados mientras el bot procesa (S24); no se pueden enviar plantillas ni adjuntos desde Loopchat; tiempo real por polling.

### Chatbots, IA y multiagente — 6
- **A favor (verificado con motor real + IA guionada):** guardas de servidor sólidas: nunca "ganada", etapas autorizadas, herramientas no habilitadas ignoradas, sin datos de otra empresa ni claves en el contexto, insultos detectados localmente sin IA (ES/EN/leet/separadores) sin falsos positivos en los casos probados, derivaciones recepción→ventas→soporte→ventas, ciclos y bots inexistentes bloqueados al publicar, respuestas tardías descartadas, versiones, simulador sin efectos (41/50 PASS).
- **En contra:** S24 (mensajes perdidos), F5 (JSON crudo al cliente), F4 (reintentos duplican tareas y consumo), S22 (efectos CRM después de la toma humana), S4b (catálogo sin contexto), S6 (descuentos solo controlados por prompt), S34b (inyección por nombre). **Ningún escenario se validó con un LLM real.**

### Seguridad — 7
- **A favor:** 0 fugas en 32 sondas HTTP cruzadas, IDs foráneos en cuerpos rechazados, cookie de empresa validada, roles 403, CSRF por Origin, secretos cifrados AES-GCM con AAD por tenant y nunca devueltos, firma HMAC de webhooks con ventana y cuenta cruzada, sin secretos en Git, sin XSS evidente, 0 vulnerabilidades altas en dependencias.
- **En contra:** SSRF por IPv6 mapeada/DNS (SEC-02), DoS por cuerpo sin límite en webhook público (SEC-03), inyección por nombre (SEC-04), rate limits en memoria (SEC-06), sin RLS, sin CSP/HSTS, sin SAST ni pentest externo.

### Estabilidad, pruebas y rendimiento — 6
- **A favor:** suite amplia y honesta (unit + integración contra PostgreSQL real + E2E con axe-core), lint y typecheck limpios, idempotencia bien pensada, API de lectura rápida (p95 56 ms a 10 concurrentes, 0 errores a 50).
- **En contra:** worker secuencial sin equidad (S48: 5,5 s de bloqueo entre empresas), riesgos de doble ejecución con varios workers, sin CI, una prueba E2E inestable bajo carga, `npm run typecheck` falla si la caché `.next/dev` se corrompe, sin prueba de carga del sistema completo.

### Infraestructura y preparación comercial — 4
- **A favor:** docker-compose de Loopchat y Chatwoot con versión fijada, documentación de despliegue, operación y restore probado (según `qa-final.md`).
- **En contra:** nunca desplegado; backups manuales sin copia externa; sin monitoreo/alertas; sin CI/CD; imagen Docker no optimizada; cobro manual (aceptado para V1); dimensionamiento no medido.

## 3. Estado por nivel

| Nivel | ¿Listo? | Por qué |
|---|---|---|
| **Demo** | **Sí** | Con simuladores y datos DEMO el producto completo se muestra de punta a punta y es coherente visualmente |
| **Piloto controlado (1–2 clientes)** | **Todavía no** | Requiere: P0-01 (validación real Meta/Chatwoot), P0-02 (mensajes concurrentes), P0-03 (worker), P1-01/02/03/06 y backups+monitoreo básicos. Estimado 15–25 días-persona |
| **Producción comercial** | **No** | Además: validador de salida de IA, SSRF/DoS, rate limits compartidos, CI con SAST, plantillas, pentest, prueba de carga real. Estimado 30–45 días-persona |

## 4. Qué haría subir la nota

| Acción | Nota esperada |
|---|---|
| Cerrar P0-02, P0-03, P1-01..P1-06 y repetir el harness con 50/50 | ~7 |
| + validación real con Meta/Chatwoot/IA (checklist de 12 pasos) | ~7,5 |
| + backups/monitoreo/CI/SAST + piloto de 2 semanas sin incidentes graves | ~8 |
| + prueba de carga real, pentest externo, RLS o test de rutas en CI | ~8,5–9 |
