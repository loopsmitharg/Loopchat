# Loopchat — Definición de producto (fuente de verdad)

**Estado:** especificación V1 para implementación; no implica que el software esté construido.  
**Producto:** Loopchat, CRM SaaS multiempresa para WhatsApp + IA, de **Loop Smiths**.  
**Idioma del documento:** español. **Idioma inicial de UI:** español (Argentina), textos preparados para internacionalización posterior.

## 1. Visión, propósito y público

Loopchat permite a cada empresa atender conversaciones de WhatsApp, colaborar entre vendedores, operar un pipeline de oportunidades tipo Kommo y automatizar atención/comercialización con IA, sin cambiar de panel. Se vende mediante suscripciones con límites combinados; el costo de las APIs de **WhatsApp Cloud API (Meta)** y de **IA** es responsabilidad de la cuenta propia de cada empresa (BYOK/BYOA, no de Loop Smiths). Loop Smiths paga y administra la infraestructura SaaS compartida.

**Primer mercado:** clientes actuales de Loop Smiths. **Canal V1:** solamente WhatsApp; otros canales son posibilidades futuras, no tareas pendientes del MVP. **Principios:** claridad operativa, confiabilidad en mensajería, separación real entre empresas, trazabilidad, mínimo costo operativo y experiencia visual propia de Loop Smiths.

**Referencias de producto, NO para copiar marca:** Kommo (pipeline, contacto asociado a chats, atención y automatizaciones), Chatwoot Community Edition (motor de mensajes). **Marca fuente:** https://loop-smith.com. **Repositorio de referencia de paleta histórica:** https://github.com/cosmear/LoopSmithWeb/blob/main/styles.css (contrastar con el sitio publicado).

## 2. Decisiones cerradas

| Decisión | Especificación |
| --- | --- |
| Nombre | Loopchat (de Loop Smiths) |
| Modelo | SaaS por suscripción, multiempresa; una instancia compartida al principio |
| Público inicial | Clientes existentes de Loop Smiths |
| Canal | WhatsApp Cloud API oficial de Meta, por cada empresa |
| Mensajería | Chatwoot **Community Edition** self-hosted, servicio independiente; NO clonar/forkear como base del frontend |
| Frontend | Next.js, TypeScript, React, App Router y Tailwind |
| Chatwoot | Ruby on Rails con PostgreSQL, Redis y workers propios en Docker en VPS; NO ejecutarlo en Cloudflare Workers |
| Backend Loopchat | Servicios del proyecto con límites tenant, API server-side y PostgreSQL propio (separado de la DB Chatwoot) |
| Automatizaciones | Workers/colas para tareas desacopladas cuando aporte valor; lógica inicial simple puede correr en el backend sin duplicación de sistemas |
| Editor de bots | Editor visual con React Flow + motor propio; **incluido en V1**, al igual que el bot básico |
| IA | API keys por empresa; adaptadores para proveedores con API compatible y adaptadores nativos cuando no lo sean |
| Humanos | Un asignado/responsable por conversación; otros autorizados pueden leer y colaborar (notas/reasignación según permiso) |
| Ventas | Etapas y pipeline Kanban configurables por empresa; contactos y oportunidades relacionados con chats |
| Suscripciones | Planes con límites combinados; los consumos externos se cargan a las cuentas de los clientes |
| Hosting | VPS Linux asequible para Chatwoot; Cloudflare Workers opcional para integraciones; NO comprometerse con un proveedor/precio rígido |
| Idioma y UX | UI es-AR en V1; responsive, escritorio prioritario, móvil plenamente utilizable |
| Branding | Paleta e identidad real de Loop Smiths, sin UI nativa de Chatwoot ni apariencia genérica |

## 3. Experiencia principal y navegación

- **Dashboard:** métricas operativas útiles, enlaces a pendientes y alertas, sin gráficas decorativas.
- **Conversaciones:** listado con filtros, estados, búsqueda y actividad; panel de chat, información de contacto y oportunidad. Ver historial y adjuntos; enviar mensaje, añadir nota privada, asignar o transferir y pausar/reanudar bot.
- **Pipeline:** Kanban de oportunidades, etapas configurables, drag-and-drop accesible/alternativa por menú; detalle con valor, origen, contacto, responsable, tareas, notas y conversación asociada.
- **Contactos:** búsqueda y ficha unificada, múltiples oportunidades por contacto, historial, etiquetas y datos de teléfono con normalización E.164.
- **Chatbots:** bot por instrucciones/FAQ/documentos + constructor visual (nodos conectados, validación, guardar borrador, publicar versión, simular); reglas de transferencia humana.
- **Configuración:** empresa, usuarios y permisos, número/canal Meta, proveedor de IA, credenciales seguras, horarios básicos, pipeline, límites y estado de suscripción.
- **Panel Loop Smiths:** gestionar empresas, altas, planes, suspensión/reactivación y consumo sin ver secretos ni conversaciones salvo autorización explícita y auditada.

## 4. Funcionalidades V1 y comportamientos

### 4.1 Inbox y agentes
- Una conversación pertenece a **exactamente una empresa** y a un contacto; puede estar sin asignar o tener un responsable. Otras personas autorizadas pueden consultar, agregar notas y solicitar/reasignar según rol. **No** varios responsables simultáneos.
- Estados de conversación: `open`, `pending`, `resolved` (o mapeo estable a estados Chatwoot) y modo de atención `bot`, `human`, `paused`; NO confundir el estado del chat con el del negocio.
- Mensajes entrantes/salientes, adjuntos, entregas/errores y orden temporal. No duplicar eventos por reintentos de webhooks. Mostrar que un mensaje falló; no fingir entrega.
- Los mensajes manuales y de bot usan **un único camino de salida a través de Chatwoot**; Chatwoot recibe los eventos de Meta y Loopchat consume eventos del motor. Evitar duplicar suscripciones a webhooks de Meta sin necesidad.
- Enviar solo según políticas vigentes de Meta: ventana de atención, plantillas aprobadas y consentimientos. Si está fuera de ventana, bloquear mensaje libre e informar la razón; permitir únicamente flujos compatibles autorizados.
- Transferencia bot→humano: bot se detiene antes de permitir la respuesta del agente; registrar motivo y actor. Reanudar bot solo manualmente o mediante regla expresa; no enviar respuestas concurrentes por accidente.

### 4.2 Contactos y negocios
- Contacto único por empresa e identidad de canal (`phone_number_id` + número normalizado); evitar fusiones entre empresas. Alias/nombre, teléfono, etiquetas, campos básicos, notas, conversaciones.
- Un contacto puede tener muchas oportunidades. Una oportunidad: `tenant_id`, pipeline, etapa, estado `open|won|lost`, responsable, importe opcional, moneda, fecha de creación y de seguimiento, última actividad.
- Pipeline personalizable por empresa: nombre, orden y etapas con nombres propios; deben existir al menos una inicial y transiciones ganada/perdida. Drag-and-drop y selector alternativo; historial auditable.
- Ejemplo de etapas, **plantilla inicial editable**: Nuevo → IA atendiendo → Requiere humano → Cotizado → Seguimiento → Ganado. No forzar estos nombres a todos los clientes.
- Tareas/recordatorios sencillos asociados a contacto u oportunidad: descripción, responsable, vencimiento, estado `pending|done|cancelled`; sin sistema completo de project management.

### 4.3 IA básica y editor visual
- Configurar por empresa uno o más proveedores de IA admitidos, modelo, instrucciones, FAQs/documentos de conocimiento, herramientas habilitadas y reglas de seguridad. **Nunca** enviar API keys al navegador ni a otro tenant.
- Adaptadores V1: al menos un proveedor funcional compatible con OpenAI y **un segundo proveedor de contrato diferente** (por ejemplo Gemini o Anthropic) verificado end-to-end. No prometer que cualquier endpoint arbitrario funciona; exponer extensibilidad para proveedores futuros.
- Bot básico: responder consultas, clasificar intención, registrar datos y oportunidad, actualizar etapa o asignar humano; respetar límites y controles contra instrucciones maliciosas en mensajes/documentos.
- Conocimiento V1: FAQs/texto + importación de archivos **solo de formatos que puedan extraerse y validarse confiablemente**, como TXT/MD y PDF textuales; sin OCR. No afirmar que se leyó un archivo si falló la extracción. No requerir RAG vectorial hasta medir necesidad; búsqueda textual simple aceptable.
- Constructor visual **funcional**: nodos `inicio`, `mensaje`, `IA`, `condición`, `crear/actualizar oportunidad`, `asignar humano`, `esperar`, `fin` como mínimo. Editor guarda borrador, valida conexiones, evita ciclos involuntarios/bucles sin límite, permite simulación y publica versiones atómicas. El runtime ejecuta los mismos grafos que el editor publica (no solo interfaz decorativa).
- Estado por ejecución: flujo, versión, conversación, paso actual, contexto permitido, estado `queued|running|waiting|completed|failed|cancelled|handed_off`, timestamp, reintentos. Idempotencia, timeout, control de cuota y cancelación del bot al pasar a humano.
- Cualquier respuesta automática debe registrar qué flujo/versión y proveedor la originó; no guardar secretos, prompts completos sensibles ni transcripciones innecesarias en logs.

### 4.4 Usuarios, cuentas, permisos
- Multiempresa real: aislamiento en todas las operaciones de lectura/escritura, archivos, mensajes, webhooks, trabajos asíncronos, métricas y claves. `tenant_id` obligatorio donde corresponda; también mapeo `tenant_id ↔ chatwoot_account_id` único y comprobable.
- Roles V1: `platform_admin` (Loop Smiths), `tenant_admin` (empresa), `manager` (administración comercial), `agent` (atención), `viewer` (solo lectura); matriz de permisos explícita y testeada. `platform_admin` no obtiene lectura silenciosa de conversaciones privadas: soporte por acceso temporal autorizado y auditable, o sin acceso.
- Alta V1 por invitación de Loop Smiths y usuarios invitados por `tenant_admin`. Inicio/cierre de sesión, recuperación de contraseña o flujo de restablecimiento seguro, invalidación de sesiones; no auth simulado en producción.
- Configuración de canal Meta V1 **manual guiada** por empresa: requerir identificadores y credenciales exactos documentados (WABA, phone number ID, token/permisos, webhook/verify cuando aplique) más medios de pago en Meta a nombre del cliente. Nunca asumir que una única clave basta.
- Guardado de credenciales cifrado en reposo, separación por tenant, rotación y estados de verificación; ocultar siempre valores completos tras guardarlos.

### 4.5 Suscripciones y medición de uso
- Un `subscription` activo por empresa con plan y límites. Cambio de plan por admin de Loop Smiths, trazabilidad, avisos y bloqueo/restricción clara al llegar al límite; sin bloqueos sorpresivos de lectura de datos.
- **Cobro automático con pasarela no entra en V1**: para clientes actuales, Loop Smiths factura/cobra por fuera y marca la suscripción en panel; integración Mercado Pago/Stripe a futuro. Esto permite una V1 realmente operable sin decisión de pasarela pendiente.
- Propuesta de defaults **editable, no precio comercial cerrado**:

| Límite | Starter | Growth | Pro |
| --- | ---: | ---: | ---: |
| Números WhatsApp | 1 | 2 | 5 |
| Agentes | 3 | 10 | 25 |
| Pipelines | 1 | 5 | configurable / uso justo |
| Bots activos | 1 | 5 | 15 |
| Llamadas de IA al proveedor/mes | 2.000 | 10.000 | 50.000 |
| Editor visual | básico | completo | completo |

- **Unidad de uso IA:** una llamada real iniciada al proveedor; registrar intentos, éxitos, fallos y costo estimado si el proveedor permite calcularlo; no confundir llamadas con mensajes. Aplicar cupos de modo atómico e idempotente por tenant. Meta/IA se facturan **directamente a las cuentas del cliente**, sujeto a verificar que no se usa una cuenta/linea de crédito central de Loop Smiths.
- Desplegar consumo de mensajes, llamadas IA, números, usuarios, bots y estado del plan; estimaciones no son facturas externas. Tarifa actual Meta varía por país/categoría/fecha: **no codificar montos históricos como constantes**.

### 4.6 Métricas mínimas
- Conversaciones por estado, entrantes/atendidos, tiempo hasta primera respuesta, oportunidades por etapa, ganadas/perdidas, valor estimado de negocios, utilización de bots y consumo por empresa/periodo. Las métricas comerciales se derivan de eventos/datos persistidos y deben señalar límites de cobertura.

## 5. Flujos esenciales (E2E)

1. **Alta empresa:** admin Loop Smiths crea tenant y asigna plan → invita admin de empresa → empresa configura número Meta y API de IA → verificación de conexión, sin exponer claves → habilitación de bots opcional.
2. **Lead entrante:** contacto escribe a WhatsApp oficial → Chatwoot recibe evento → Loopchat lo sincroniza sin duplicarlo → crea o vincula contacto → bot opcional responde (o queda para humano) → oportunidad aparece en pipeline → un agente toma chat y actualiza negocio.
3. **Colaboración:** supervisor observa conversación → deja nota interna o reasigna → solo una persona figura como responsable → agente escribe mensaje manual → bot permanece pausado cuando corresponde.
4. **Constructor:** admin crea flujo → configura nodos y rutas → simulación sin enviar WhatsApps reales → valida → publica versión → mensaje entrante ejecuta flujo publicado → persiste estado y reintentos → puede escalar a humano.
5. **Suscripción:** se asigna Starter/Growth/Pro → uso incrementa cupo correctamente → al agotar límite se impiden **nuevas ejecuciones** afectadas, se informa razón y no se pierden conversaciones históricas.
6. **Multiempresa:** un usuario de empresa A intenta manipular URL/ID de empresa B → API devuelve acceso denegado y no filtra existencia, datos, documentos, uso ni tokens.
7. **Proveedor caído:** timeout/API fallida → mensaje de estado, reintentos acotados, fallback a agente humano sin generar respuestas duplicadas.

## 6. Modelo de datos conceptual

Entidades mínimas: `tenants`, `users`, `memberships`, `roles/permissions`, `invitations`, `subscriptions`, `plans`, `usage_events`, `usage_periods`, `channel_connections`, `ai_provider_connections`, `contacts`, `conversations` (mapeo de Chatwoot), `messages` (índices/metadatos locales necesarios, evitar duplicar toda historia sin necesidad), `pipelines`, `stages`, `opportunities`, `opportunity_history`, `tasks`, `internal_notes`, `bots`, `bot_versions`, `flow_nodes/edges` (o JSON versionado validado), `flow_runs`, `knowledge_sources`, `audit_logs`, `webhook_events`. Entidades persistentes tenant-owned deben tener `tenant_id`, indexes apropiados y llaves foráneas consistentes. IDs externos siempre validados contra el tenant antes de llamar a Chatwoot.

**Source of truth:** Chatwoot → mensajes/conversaciones/estado técnico de entrega; Loopchat → tenant/plan, bot/automatizaciones, contactos CRM enriquecidos, etapas/oportunidades y uso de producto. Sincronizaciones idempotentes y reconciliación programada ante eventos perdidos.

## 7. Seguridad, privacidad y rendimiento

- TLS, no secretos en Git/frontend/URLs públicas; autenticación y autorización servidor; password hashing estándar, sesiones seguras, CSRF cuando aplique, rate limits por endpoint sensible y auditoría de acciones críticas.
- Firma o validación documentada de eventos entrantes; si Chatwoot no ofrece firma apropiada, usar un mecanismo de autenticación alternativo comprobado o canal confiable, nunca asumir que un webhook público es seguro. Revisar configuración real de versión instalada.
- Cifrado de credenciales, llaves fuera del código, rotación/revocación; mínimo acceso por tenant, protección contra SSRF/archivos maliciosos/prompt injection/automatizaciones abusivas.
- Redacción y borrado conforme a política propia; permisos de lectura del histórico; exportación básica del cliente. Definir retención razonable y declararla en política antes de producción; no inventar obligaciones legales.
- Integridad en mensajes por `external_id` y reintentos; transiciones atómicas, límites de concurrencia, latencias observadas y métricas. Objetivo orientativo para la UI: navegación percibida ágil, paginación de conversaciones y carga incremental; no establecer SLA numérico sin mediciones.
- Responsive: escritorio 1440/1280 y móvil 390/375, tablet 768; chat y Kanban accesibles sin overflow horizontal global; teclado, foco visible, contraste WCAG AA donde aplica; `prefers-reduced-motion`.
- Deploy inicial austero: Chatwoot + PostgreSQL + Redis en VPS **con respaldos consistentes separados**, aplicación Node/Next compatible con el hosting elegido, Workers solo cuando se necesiten. Dimensionar por pruebas; un VPS barato no garantiza concurrencia alta.

## 8. Criterios de V1 terminada (Definition of Done)

- El sistema funciona localmente con servicios documentados y puede desplegarse con instrucciones reproducibles.
- E2E autenticado tenant A/B: aislamiento positivo y negativo probado en API, UI y eventos/colas; sin secretos expuestos.
- Desde la **UI propia de Loopchat**, llegan mensajes reales de Meta vía Chatwoot, se visualizan y se contestan por WhatsApp; o, si faltan credenciales externas, existe modo de integración reproducible con fixtures y una lista honesta de pruebas reales pendientes. La V1 de producción **no se declara validada end-to-end** sin probarla con Meta real.
- Contactos, pipeline, movimiento de oportunidades, notas, responsables y bot→humano funcionan con persistencia real.
- Bot básico y editor visual ejecutan reglas reales con simulador; al menos dos adaptadores IA verificados en pruebas, con pruebas reales contra proveedores solo si hay credenciales disponibles.
- Suscripciones y cuotas efectivamente restringen escrituras/ejecuciones, con panel de administración funcional; cambios auditados.
- Lint, typecheck, unitarios, integración, E2E, build, revisión visual y seguridad crítica sin fallas bloqueantes; operación, backups, restore y variables documentadas.

## 9. Non-goals / Out of Scope de V1

No construir: Instagram, Messenger, email, SMS o campañas omnicanal; clon pixel-perfect de Kommo; WhatsApp mediante QR/no oficial; envío masivo en frío, scraping de números o evasión de políticas Meta; IA propia entrenada desde cero; marketplace de integraciones; n8n embebido (licenciamiento) o constructor arbitrario de código; llamadas de voz; CRM fiscal/contable; facturación electrónica; pasarela de pagos automática; ERP; app móvil nativa; SSO enterprise; agentes con herramientas ilimitadas; analytics predictivos; OCR universal; RAG/vectorización compleja sin necesidad; soporte de decenas de proveedores IA; ilimitados tenants sin dimensionamiento; rebranding del panel original Chatwoot; funciones Enterprise de Chatwoot sin licencia; features que no estén en este documento.

## 10. Open Decisions (realmente abiertas, NO bloquean desarrollo local)

1. **Proveedor definitivo del VPS y dominio de despliegue:** se decide al contratar; diseñar deployment portable.
2. **Servicio de emails transaccionales y canal de cobro futuro:** usar adaptadores/config por entorno; V1 permite invitaciones con SMTP estándar y cobro manual.
3. **Precios comerciales finales:** planes/cupos iniciales son defaults configurables, sin comprometer precio al público.
4. **Claves y accesos a Meta/IA/hosting:** dependencias externas que el usuario debe proveer; implementar con fixtures/local antes.
5. **Branding exacto vigente:** inspeccionar CSS/assets reales de https://loop-smith.com; la paleta del repositorio histórico es referencia verificable, no una sustitución automática del sitio actual.

No reabrir las decisiones de la tabla de la sección 2 sin evidencia de incompatibilidad técnica, legal o costo prohibitivo. Documentar cambios y justificar.
