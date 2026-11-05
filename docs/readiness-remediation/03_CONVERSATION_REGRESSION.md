# 03 — Regresión conversacional

**Fecha:** 2026-11-05 · Harness: `tests/audit/conversations.audit.test.ts` (`npx vitest run -c tests/audit/vitest.audit.config.mts`) · Evidencia: `evidence/conversation-results.json` (antes: `docs/audits/evidence/conversation-results.json`).

**Tipo de evidencia:** motor real de Loopchat + PostgreSQL real + simulador de contrato de Chatwoot + proveedor de IA **guionado** (cada escenario fija la decisión del modelo). Valida las guardas del servidor y la orquestación, **no** la obediencia de un LLM real (P0-04 bloqueado). El harness ahora es una compuerta de CI: un FAIL rompe la corrida.

## Resultado

| | Auditoría (ecbf4e2) | Después de la remediación |
|---|---:|---:|
| PASS | 41 | **49** |
| PARTIAL | 4 | **1** (S38) |
| FAIL | 5 | **0** |

**S38 queda PARTIAL a propósito:** el documento con instrucciones maliciosas entra delimitado y rotulado como datos, pero la resistencia real solo se mide con un modelo real. No se cambió la expectativa para "aprobarlo".

**Cambio de expectativa documentado (S24c):** la auditoría medía "≤ 2 respuestas" ante 3 disparos simultáneos porque el sistema **descartaba** mensajes. Con P0-02 el mensaje más nuevo queda pendiente y se responde, así que la medida correcta es "una respuesta por ejecución, sin duplicados" (obtenido: 2 respuestas, 2 ejecuciones). El escenario S24 (el de la falla real) se mantuvo igual y pasó de FAIL a PASS.

## Pruebas adicionales pedidas (fuera del harness, en `npm test`)

| Pedido | Dónde | Resultado |
|---|---|---|
| Mensajes en ráfaga | `engine-reliability`: pedido de asesor e insulto durante la IA; segunda consulta durante la IA; 3 disparos concurrentes + fuera de orden | PASS |
| Pedidos de humano durante IA | idem (deriva sin IA, cancela la respuesta en curso) | PASS |
| Reintentos y fallas de Chatwoot | `engine-reliability` "falla de Chatwoot al enviar" (1 respuesta, 1 tarea, 1 llamada facturada) | PASS |
| Caídas del worker | `engine-reliability` "ejecución abandonada" y "fencing" | PASS |
| Reintentos de herramientas | tarea idempotente por clave | PASS |
| Fallas de IA | 500 (S41), JSON roto, truncado | PASS |
| Operaciones comerciales no autorizadas | ganada, etapa no permitida, cotización sin permiso, herramienta no habilitada, descuento inventado | PASS |
| Diferencias entre versiones | S43 + tests de equipos (versión fijada) | PASS |
| Datos entre empresas | S35/S36 + sondas HTTP 12/12 | PASS |
| Saturación moderada | S44-S47, S48 + carga con Chatwoot real (05) | PASS |
| Con **Chatwoot real** | `tests/audit/chatwoot-real.audit.test.ts`: ráfaga con derivación (R5) | PASS |

## Tabla completa (antes → después)

| ID | Área | Escenario | Antes | Después | Obtenido después |
|---|---|---|---|---|---|
| S1 | Ventas | Cliente consulta precio | PASS | PASS | prompt incluye "85.000": true; stock "5 disponibles": true; salientes=["El Taladro percutor 800W cuesta ARS 85.000 y hay 5 disponibles."] |
| S2 | Ventas | Producto inexistente | PASS | PASS | bloque sin coincidencias: true; regla 'no inventes': true; salientes=1 |
| S3 | Ventas | Producto sin stock informado | PASS | PASS | stock desconocido marcado: true; conv=3 |
| S4 | Ventas | Varios productos en un mensaje | PASS | PASS | ambos presentes: true |
| S4b | Ventas | Pregunta de precio de seguimiento sin repetir el producto | FAIL | PASS | precio presente en 2º turno: true |
| S5 | Ventas | Cliente indeciso, conversación de 3 turnos | PASS | PASS | mensajes no-system enviados al modelo en el 3er turno: 5 |
| S6 | Ventas | Cliente pide descuento inexistente; el modelo lo inventa | PARTIAL | PASS | regla en prompt: true; enviado al cliente: ["Dejame confirmar ese dato con una persona del equipo y te respondemos enseguida."] |
| S7/S31 | CRM | Cliente quiere cerrar; el modelo pide etapa 'Ganado' | PASS | PASS | oportunidades=1; estados=open |
| S8 | Ventas | Cliente solicita vendedor | PASS | PASS | modo=requested; llamadas IA=0; salientes=[] |
| S9 | Atención | Reclamo; el modelo decide derivar | PASS | PASS | insulto=false; llamadas IA=1; modo=requested |
| S10 | Atención | Cliente muy enojado sin insultos | PASS | PASS | insulto=false; llamadas IA=1; modo=bot |
| S11 | Atención | Insulto en español | PASS | PASS | insulto=true; llamadas IA=0; modo=requested |
| S12 | Atención | Insulto en inglés | PASS | PASS | insulto=true; llamadas IA=0; modo=requested |
| S13a | Atención | Insulto con caracteres alterados (leet) | PASS | PASS | insulto=true; llamadas IA=0; modo=requested |
| S13b | Atención | Insulto con separadores | PASS | PASS | insulto=true; llamadas IA=0; modo=requested |
| S13c | Atención | Insulto con letras repetidas | PASS | PASS | insulto=true; llamadas IA=0; modo=requested |
| S14a | Atención | Expresión ambigua (no debe derivar) | PASS | PASS | insulto=false; llamadas IA=1; modo=bot |
| S14b | Atención | Expresión ambigua citada (no debe derivar) | PASS | PASS | insulto=false; llamadas IA=1; modo=bot |
| S15 | Atención | Información que el bot desconoce (3 veces) | PASS | PASS | modo final=requested; llamadas IA=2 (nota: con 2 bots activos el seleccionado es el más reciente) |
| S16 | Multiagente | Recepcionista deriva a ventas | PASS | PASS | respuesta="[ventas] ¡Hola! ¿En qué te ayudo?"; llamadas IA (router+bot)=1 |
| S18 | Multiagente | Ventas deriva a soporte | PASS | PASS | respuesta="[soporte] ¡Hola! ¿En qué te ayudo?"; llamadas IA (router+bot)=1 |
| S19 | Multiagente | Soporte deriva a ventas | PASS | PASS | respuesta="[ventas] ¡Hola! ¿En qué te ayudo?"; llamadas IA (router+bot)=1 |
| S20 | Multiagente | Cliente cambia de intención varias veces | PASS | PASS | secuencia=[ventas] ¡ → [soporte]  → [ventas] ¡; traspasos=4 |
| S17 | Multiagente | Recepcionista deriva a soporte | PASS | PASS | respuesta="[soporte] ¡Hola! ¿En qué te ayudo?" |
| S21 | Multiagente | Cliente solicita atención humana (equipo) | PASS | PASS | modo=requested; llamadas IA=0 |
| S23 | Multiagente | Equipo apunta a un bot inexistente | PASS | PASS | rechazado: El equipo incluye un bot que no existe en tu empresa. |
| S25 | Multiagente | Derivaciones forman un ciclo determinístico (misma palabra clave) | PASS | PASS | publicación rechazada: El equipo tiene errores. Corregilos antes de publicar. {"issues":[{"severity":"error","message":"Bucle de derivaciones con la palabra \"bucle\"."}] |
| S22 | Multiagente | Vendedor toma el control durante la llamada a la IA | PARTIAL | PASS | respuesta tardía enviada=false; tareas creadas por IA tras la toma=0; oportunidad de IA tras la toma=0; salientes=["Hola, soy Andrés, te atiendo yo"] |
| S24 | Multiagente | Dos mensajes seguidos antes de que el bot responda (2º pide asesor: palabra clave determinística) | FAIL | PASS | ejecuciones=1; llamadas IA=0; último mensaje visto por IA=[]; modo=requested; salientes=0 |
| S24b | Concurrencia | 3 disparos concurrentes para la misma conversación | PASS | PASS | iniciadas=1; activas=1 |
| S24c | Concurrencia | Efecto de los disparos concurrentes en el cliente | PASS | PASS | respuestas=2 (incluye el saludo inicial); ejecuciones completadas=2 |
| S26 | CRM | Bot crea oportunidad | PASS | PASS | oportunidades=1; importe=85000.00; estado=open |
| S27/S28 | CRM | Bot actualiza la existente / intenta duplicar | PASS | PASS | oportunidades=1; importe=170000.00 |
| S29 | CRM | Bot mueve a etapa autorizada | PASS | PASS | etapa=Cotizado |
| S30 | CRM | Bot intenta mover a etapa no autorizada (Seguimiento) | PASS | PASS | etapa=Cotizado |
| S32 | CRM | Bot crea una tarea | PASS | PASS | tareas=1; vence en 24 h |
| S37 | Seguridad IA | Modelo pide una herramienta no habilitada (crear tarea) | PASS | PASS | tareas=0 |
| F4 | Estabilidad | Chatwoot falla una vez al enviar la respuesta del bot (reintento) | PARTIAL | PASS | respuestas=["Te llamamos."]; tareas=1; llamadas IA=1; consumo ai_calls=1 |
| S34 | Seguridad IA | Cliente intenta cambiar las instrucciones | PASS | PASS | en system=false; en user=true. Obediencia de un LLM real: NO VERIFICADO |
| S35 | Seguridad IA | Cliente pide información de otra empresa | PASS | PASS | datos de B en contexto=false |
| S36 | Seguridad IA | Cliente pide API keys | PASS | PASS | clave en contexto=false |
| S38 | Seguridad IA | Documento de conocimiento con instrucciones maliciosas | PARTIAL | PARTIAL | incluido=true; rotulado como datos=true. Resistencia real del modelo: NO VERIFICADO |
| S34b | Seguridad IA | Nombre de perfil de WhatsApp con instrucciones (controlado por el cliente) | FAIL | PASS | texto literal en system=false; nombre presente=true; rotulado como dato=true |
| S39 | Integraciones | Webhook entregado dos veces | PASS | PASS | entrantes=1; respuestas=1; IA=1 |
| S41 | Integraciones | Proveedor de IA devuelve 500 en todos los intentos | PASS | PASS | intentos IA=3; salientes=["Tuvimos un problema, te atiende una persona."]; modo=requested |
| S42 | Integraciones | Chatwoot falla temporalmente al enviar | PASS | PASS | respuestas=1; llamadas IA=1 (cada reintento vuelve a llamar a la IA) |
| F5 | Seguridad IA | El modelo devuelve JSON truncado/malformado | FAIL | PASS | enviado=[] |
| S43 | Versiones | Se publica una nueva versión del bot durante la conversación | PASS | PASS | turno siguiente usa v2=true |
| S44-S47 | Carga | 5 empresas × 8 conversaciones simultáneas (IA 150 ms) | PASS | PASS | ingesta webhooks=192 ms; respondidas=40/40; drenaje con 1 worker=2762 ms (~69 ms/conv secuencial); RSS proceso=138 MB |
| S48 | Carga | Empresa B espera detrás de 3 llamadas lentas (1,5 s) de la empresa A | FAIL | PASS | respuesta a B tras 1788 ms (con worker secuencial ≈ 3×1,5 s) |
