# 07 — Nueva calificación

**Fecha:** 2026-11-05 · Rama `fix/loopchat-production-readiness` (último commit de código antes de este informe: `4ee1697`) · Mismo sistema de puntuación que la auditoría.

## Notas

| Área | Peso | Antes | Ahora | Ponderado |
|---|---:|---:|---:|---:|
| CRM y WhatsApp | 20 % | 6 | **7** | 1,40 |
| Chatbots e IA | 25 % | 6 | **7** | 1,75 |
| Seguridad y aislamiento | 25 % | 7 | **8** | 2,00 |
| Estabilidad y rendimiento | 15 % | 6 | **8** | 1,20 |
| Infraestructura y producción | 15 % | 4 | **6** | 0,90 |
| **Total calculado** | | 5,95 | **7,25** | |
| **Total informado (con restricciones)** | | **6,0** | **7,0** | |

**Restricción aplicada:** "si el flujo completo de WhatsApp nunca fue validado con una integración real, la nota total no puede superar 7". Chatwoot se validó **real**, pero Meta/WhatsApp no → tope 7,0. No hay vulnerabilidades críticas de aislamiento abiertas; autenticación y permisos están verificados con pruebas.

## Justificación

**CRM y WhatsApp — 7 (antes 6).** A favor: mensajes en ráfaga ya no se pierden; plantillas desde Loopchat; integración con **Chatwoot real** verificada (aprovisionamiento, webhook firmado, sincronización, envío, eco, idempotencia, `template_params`); E2E 27/27. En contra: Meta nunca probado; adjuntos salientes y plantillas multimedia siguen fuera.

**Chatbots e IA — 7 (antes 6).** A favor: 49/50 escenarios (0 FAIL); validación comercial en servidor; salida inválida nunca llega; idempotencia; autoridad transaccional; límites de consumo; ráfaga verificada también con Chatwoot real. En contra: **ningún LLM real** probado (P0-04); S38 sigue sin medirse contra un modelo.

**Seguridad — 8 (antes 7).** A favor: SSRF, límite de cuerpos, inyección por nombre, rate limits compartidos y por cuenta, política de suspensión, todo con regresión; 12/12 sondas A/B sobre el build de producción; Gitleaks limpio. En contra: sin RLS, sin CSP, Semgrep y pentest externo no ejecutados.

**Estabilidad y rendimiento — 8 (antes 6).** A favor: worker concurrente con equidad, leases y fencing; 270/270 tests, E2E 27/27 en la primera corrida; 40 conversaciones 14,2 s → 2,8 s; empresa B ya no espera a la A; carga con Chatwoot real 24/24. En contra: sin prueba con IA y Meta reales; CI no ejecutado en GitHub.

**Infraestructura y producción — 6 (antes 4).** A favor: backups cifrados con verificación y restore real probado; monitor con alertas reales probadas; CI escrito; documentación de despliegue corregida con un hallazgo real. En contra: nunca desplegado; sin bucket externo ni canal de alertas reales; timers no instalados.

## Estado por nivel

| Nivel | ¿Listo? | Condición |
|---|---|---|
| Demo | Sí | — |
| **Piloto controlado (1–2 clientes de confianza)** | **Sí, condicionado** | Antes del primer cliente: ejecutar los 12 pasos con un número de prueba de Meta en staging (P0-01), una prueba con la IA real que use el cliente (P0-04), bucket + alertas reales, CI en verde en GitHub. Estimado: 3–6 días técnicos + tiempos de Meta |
| Producción comercial | **No** | Además: piloto de 2+ semanas sin incidentes graves, prueba de carga con Meta/IA reales, Semgrep/pentest, RLS o equivalente, CSP |

## Distinción de evidencia por corrección

| Nivel | Correcciones |
|---|---|
| Implementada y comprobada localmente | P0-02, P0-03, P1-01…P1-11, P1-13, P1-14, P2-04, P2-05, P2-12 |
| Comprobada en integración con Chatwoot real | P0-02 (ráfaga), P1-13 (`template_params`), webhook/firmas, envío idempotente |
| Comprobada en staging | Ninguna (no hay staging) |
| Comprobada en producción | Ninguna |
| Implementada sin ejecución en su plataforma | P1-12 (GitHub Actions) |
| Bloqueada | P0-01 (Meta), P0-04 (IA real) |
