# Módulo de chatbots — mejoras (2026-10-21)

Se amplió el módulo existente sin reconstruirlo: mismo intérprete de flujos, mismas versiones inmutables, mismo camino de salida (Chatwoot), mismas conexiones de IA por empresa (BYOK).

## Qué se agregó

| Área | Funcionalidad | Dónde |
|---|---|---|
| Configuración extendida | `bots.config` (jsonb) validado con Zod, con valores por defecto; parches por sección que no pisan otros campos | `src/lib/bot-config.ts`, `src/server/services/bots.ts` |
| Versiones | `bot_versions.settings`: copia inmutable de instrucciones, herramientas, palabras clave, conexión/modelo, configuración y productos asociados. El runtime ejecuta lo publicado; **guardar no cambia lo publicado**. "Recuperar como borrador" restaura una versión anterior (sin publicar). Aviso de cambios sin publicar | `src/server/flows/settings.ts`, `restoreVersion` |
| Insultos | Detección local multilingüe previa a la IA → derivación `insult_detection` | `docs/insult-detection.md` |
| Control humano | Nuevo estado **`requested`** (“Pide humano”) además de `bot` / `human` / `paused`. Respuestas tardías descartadas (envío del bot exige modo `bot` con bloqueo de fila). Reactivación manual; automática solo con la regla explícita “al resolver la conversación”. “Pausar la IA cuando interviene una persona” queda siempre activo (es un invariante de seguridad) | `src/server/flows/policy.ts`, `conversations.ts`, `outbound.ts` |
| Catálogo | `products` (título y descripción obligatorios; precio, stock y foto opcionales; stock `null` ≠ 0; archivar en lugar de borrar), `bot_products` (asociación). Búsqueda, filtros por disponibilidad y estado, foto validada por firma real (JPG/PNG/WEBP ≤ 5 MB) servida con control de acceso | `src/server/services/products.ts`, `/api/v1/products/*` |
| IA + catálogo | Herramienta `use_catalog`: productos relevantes de la empresa (y del bot) con precio/stock marcados “NO INFORMADO” o “sin información” cuando faltan; foto enviada como adjunto por Chatwoot (multipart `attachments[]`) solo de productos provistos en el turno | `ai-step.ts`, `ai-turn.ts`, `chatwoot/client.ts` |
| Reglas de herramientas | Etapas permitidas (nunca ganada/perdida), responsable y vencimiento por defecto/máximo de tareas, oportunidad única abierta por contacto, IA puede o no pedir humano. Todo validado en el servidor; los intentos no permitidos se registran como “bloqueados” | `ai-turn.ts`, `parseAiDecision` |
| Personalidad | Tono, largo, emojis, idioma, responder en el idioma del cliente, bienvenida fija | `src/lib/bot-style.ts` |
| Horarios y reglas | Fuera de horario: responder / avisar y seguir / avisar y derivar; máximo de consultas seguidas sin resolver antes de derivar | `runtime.ts` (`preAiGuards`) |
| Memoria comercial | Resumen acotado (≤ 1200 caracteres): conversaciones previas, oportunidades abiertas, tareas pendientes, productos consultados | `src/server/flows/memory.ts` |
| Objetivos comerciales | `lead_fields` por empresa (texto/número/lista) y `contacts.lead_data`; el bot guarda solo campos habilitados y valores válidos; no pisa datos cargados por una persona; visibles y editables en la conversación y la ficha | `src/server/services/lead-fields.ts` |
| Simulador | Mismas reglas previas y mismo armado de contexto que el runtime, sin efectos; casos rápidos; resumen por mensaje (IA llamada, herramientas, bloqueos, derivación) | `src/server/services/simulate.ts`, `simulator.tsx` |
| Ejecuciones | `flow_runs.metrics`: llamadas a IA, tokens, latencia, herramientas, bloqueadas, productos, motivo de derivación (sin secretos ni contenido del mensaje) | `runtime.ts`, `bot-detail.tsx` |

## Decisiones

- **Mensaje de transferencia vacío por defecto** para no cambiar el comportamiento de bots existentes; la interfaz ofrece el texto sugerido con un clic. La detección de insultos sí viene activada por defecto (pedido explícito).
- **Asociación de productos versionada; datos del producto en vivo.** Cambiar precio o stock aplica al instante (no hay que reescribir instrucciones ni republicar); asociar/quitar productos se aplica al publicar.
- **“Eliminar” archiva**: el producto se conserva para el historial y sale de los bots.
- **Notificación al equipo = tarea** (visible en Tareas y en el contador): no se agregó un sistema de notificaciones nuevo.
- **Parches sin valores por defecto**: en Zod 4, `.partial()` mantiene los `.default()`; se construyen esquemas de parche explícitos (corrige además que un PATCH parcial reiniciara herramientas y palabras clave).
- **Comparación de versiones con JSON canónico** (jsonb no conserva el orden de claves).

## Lo que necesita servicios reales para verificarse

- Envío de fotos por WhatsApp: verificado contra el simulador de contrato de Chatwoot (multipart `attachments[]`, como la API de Chatwoot); falta probar con Chatwoot y Meta reales.
- Calidad de las respuestas con un modelo real (catálogo, objetivos, tono): verificable con la clave del cliente (“Usar el proveedor de IA real” en Probar).
