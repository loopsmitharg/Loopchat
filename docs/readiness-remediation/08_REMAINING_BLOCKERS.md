# 08 — Bloqueos y pendientes

Ordenados por gravedad e impacto en la puesta en marcha. "Acción" indica exactamente qué hace falta y quién.

## Bloqueos externos (impiden declarar producción)

| # | Pendiente | Por qué está bloqueado | Acción necesaria | Quién |
|---|---|---|---|---|
| 1 | **P0-01 — Circuito real Meta → Chatwoot → Loopchat → WhatsApp** | No hay número de prueba de Meta ni servidor público con TLS. Chatwoot real se probó localmente sin Meta (ver 05) | (a) Crear app en Meta for Developers con número de prueba (WABA ID, Phone Number ID, token de sistema con `whatsapp_business_messaging` y `whatsapp_business_management`); (b) VPS de staging con dominio y TLS para Chatwoot (Meta exige HTTPS para el webhook); (c) ejecutar los 12 pasos de `docs/qa-final.md §8` y registrar evidencia | Loop Smiths (cuentas, VPS, dominio); luego la ejecución es técnica (~1–2 días) |
| 2 | **P0-04 — Proveedores de IA reales** | Sin claves autorizadas | Una clave de prueba por proveedor con tope de gasto (USD 5–10): OpenAI (o compatible) y Anthropic o Gemini. Ejecutar `04_CONVERSATION_TESTS §6` + escenarios de 03 (descuentos, inyección, catálogo) con 3 corridas cada uno | Loop Smiths (claves); ejecución ~1 día |
| 3 | **CI en GitHub** | El workflow existe y sus pasos se corrieron localmente, pero nunca corrió en GitHub (no hubo push autorizado) | Push de la rama y abrir PR; ajustar si Semgrep (no ejecutable en Windows) reporta algo | Loop Smiths autoriza el push |
| 4 | **Copia externa y alertas reales** | Sin bucket ni canal de alertas | Crear bucket (B2/S3/R2) con versionado/bloqueo de objetos y credenciales de solo escritura para `rclone`; webhook de Slack/Discord o email para alertas; generar el par de claves de backup y guardar la privada offline | Loop Smiths |

## Pendientes técnicos (no bloquean un piloto controlado)

| # | Pendiente | Gravedad | Detalle / próximo paso |
|---|---|---|---|
| 5 | Prueba de carga del sistema completo | P1 | Solo se midió Loopchat con simuladores. Con Chatwoot real + IA real en staging: 5/10/20 empresas simuladas, medir latencia mensaje→respuesta, Sidekiq, memoria del VPS |
| 6 | Resistencia real a inyección (S38) | P1 | Las defensas estructurales están; la obediencia de un LLM real solo se mide con P0-04 |
| 7 | Envío de adjuntos por agentes (P2-08) | P2 | Recibir sí; enviar desde Loopchat no (usar Chatwoot) |
| 8 | Plantillas con encabezado multimedia o botones con parámetros | P2 | Se muestran como no disponibles; usar Chatwoot |
| 9 | RLS como segunda barrera de aislamiento (P2-01) | P2 | Hoy: aislamiento en aplicación + sondas HTTP A/B en CI |
| 10 | Historial vacío si Chatwoot falla al leer (P2-03) | P2 | La IA responde sin contexto; conviene reintentar o derivar |
| 11 | CSP (P2-06) | P2 | HSTS documentado en el proxy; falta CSP estricta |
| 12 | Open redirect en `/login?next=` (P2-07, hipótesis) | P3 | Validar origen |
| 13 | Revocación global de sesiones al deshabilitar en una empresa (P2-02) | P2 | Revocar solo el acceso a esa empresa |
| 14 | Autoinvitación de administradores de plataforma (P2-11) | P2 | Aprobación del cliente o acceso temporal auditado |
| 15 | Tiempo real por polling (P2-10) | P3 | Medir con uso real |
| 16 | Mensaje en estado `sending` si el proceso cae entre aceptar Chatwoot y registrar | P3 | Límite de Chatwoot (sin clave idempotente); se prefiere no duplicar. Monitorear |
| 17 | Cifrado de backups CBC sin autenticación | P3 | Integridad por SHA-256; usar bucket con bloqueo de objetos o migrar a `age` |

## Riesgo principal que permanece

Que el comportamiento real de Meta/Chatwoot en producción (tiempos, validaciones de la bandeja de WhatsApp, entregas, estados) difiera de lo probado con el simulador y con Chatwoot sin Meta. Es el único camino crítico que no se pudo ejercitar de punta a punta.
