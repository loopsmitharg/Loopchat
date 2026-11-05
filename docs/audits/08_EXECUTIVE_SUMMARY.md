# 08 — Resumen ejecutivo para Loop Smiths

**2026-11-04 · versión auditada: v0.5 (`ecbf4e2`)**

## En una frase
Loopchat está **muy bien construido para su etapa** y es **seguro entre empresas** en lo que se pudo probar, pero **todavía no está listo para clientes reales**: nunca se conectó a WhatsApp/Chatwoot/IA reales, y el motor de bots tiene defectos de concurrencia que harían que algunos clientes se queden sin respuesta.

**Nota general: 6,0 / 10 — Estado: listo para DEMO; NO listo para piloto ni producción.**

| Área | Nota | Estado |
|---|---:|---|
| CRM y WhatsApp | 6 | CRM completo; WhatsApp solo probado con simuladores |
| Chatbots e IA | 6 | Controles comerciales buenos; defectos con mensajes en ráfaga y reintentos |
| Seguridad | 7 | Sin fugas entre empresas; 3 problemas medios a corregir |
| Estabilidad | 6 | 209 pruebas en verde; el procesador de bots atiende de a uno |
| Infraestructura | 4 | Nunca desplegado; sin backups automáticos ni monitoreo |

## Qué se probó
- Las **209 pruebas** propias del proyecto: todas pasan. Las **26 pruebas de navegador**: 25 en la corrida completa y la restante pasa al repetirla (inestable por tiempos).
- **50 conversaciones simuladas** de clientes (ventas, reclamos, insultos, equipos de bots, ataques) sobre el motor real: 41 bien, 4 a medias, 5 mal.
- **Intentos de una empresa de ver datos de otra** por la API real: 32 intentos, **0 fugas**.
- Carga moderada en local: la parte web aguanta ~400 pedidos por segundo sin errores.
- **No se probó** con Meta, Chatwoot ni proveedores de IA reales (no había credenciales autorizadas).

## Los cinco problemas que más afectan el lanzamiento
1. **Nunca se probó con WhatsApp y Chatwoot reales.** Todo funciona contra simuladores escritos a partir del código de Chatwoot; las diferencias aparecen recién con el servicio real.
2. **Si el cliente manda dos mensajes seguidos, el bot ignora el segundo.** Incluso si el segundo dice "quiero hablar con un asesor", la conversación sigue con el bot. En WhatsApp esto pasa todo el tiempo.
3. **El procesador de bots atiende un mensaje a la vez para todas las empresas.** Si la IA de una empresa tarda, todas las demás esperan (medido: 5,5 s de demora causada por otra empresa).
4. **Las respuestas de la IA no se validan.** Si el modelo inventa un descuento, se envía; si responde con un texto cortado, el cliente recibe código técnico; si hay un reintento, se crean tareas duplicadas y se cobra la IA dos veces.
5. **Sin operación de producción:** no hay backups automáticos fuera del servidor, ni alertas, ni integración continua.

## Qué funciona bien (verificado)
- Separación entre empresas en la API real.
- Los bots **no pueden** marcar ventas como ganadas, ni mover oportunidades a etapas no permitidas, ni usar herramientas que no tienen habilitadas.
- Detección de insultos en español e inglés (también disfrazados) que deriva a una persona sin gastar IA, sin falsos positivos en los casos probados.
- Equipos de bots: recepción → ventas → soporte → ventas, sin dos bots respondiendo a la vez, sin bucles.
- Claves de IA y de Meta cifradas y nunca visibles; cada empresa usa sus propias claves (Loop Smiths no paga consumos ajenos).
- Interfaz propia, coherente, responsive y accesible; simulador de bots útil y sin efectos reales.

## Qué todavía no funciona
- Mensajes en ráfaga (punto 2), concurrencia del procesador (punto 3), validación de respuestas (punto 4).
- El bot olvida el precio de un producto si el cliente pregunta "¿y cuánto sale?" sin repetir el nombre.
- Si un vendedor toma la conversación mientras la IA piensa, la respuesta no sale (bien), pero la tarea y la oportunidad que decidió la IA se crean igual.
- No se pueden enviar plantillas de WhatsApp (para reabrir conversaciones de más de 24 h) ni adjuntos desde Loopchat.
- Tres problemas de seguridad medios: un filtro de direcciones internas que se puede eludir, un punto público que acepta envíos gigantes, y el nombre de perfil del cliente que entra a las instrucciones del bot.

## Qué hace falta para vender Loopchat
**Mínimo para un piloto con 1–2 clientes de confianza (≈ 15–25 días de trabajo + espera de Meta):**
1. Montar Chatwoot en un servidor de prueba y conectar un número real; recorrer el checklist de 12 pasos.
2. Corregir mensajes en ráfaga y el procesador de a uno.
3. Validar las respuestas de la IA (texto cortado, reintentos, control humano) y el nombre de perfil.
4. Backups automáticos externos y alertas básicas.
5. Probar con una clave real de IA con tope de gasto.

**Para venta general (≈ 30–45 días en total):** además, validador de precios/descuentos, los 3 problemas de seguridad, límites de intentos compartidos, integración continua con análisis de seguridad, plantillas de WhatsApp, prueba de carga con Chatwoot real y una revisión de seguridad externa.

## Próximas acciones (en orden)
1. Pedir hoy el número/WABA de prueba a Meta (lo que más demora).
2. Corregir P0-02 (mensajes en ráfaga) y P0-03 (procesador concurrente).
3. Corregir P1-01, P1-02, P1-03, P1-06 (respuestas de IA).
4. Staging con Chatwoot real + checklist de 12 pasos + clave real de IA.
5. Backups, monitoreo y CI; luego seguridad (SSRF, límites de tamaño, rate limits).
6. Piloto de 2 semanas con un cliente, con monitoreo diario.

## Estimación final
- Piloto controlado: **15–25 días-persona** + tiempos de Meta.
- Producción comercial: **30–45 días-persona**.
- Lo que más puede cambiar la estimación: diferencias reales de Chatwoot/Meta respecto del simulador; la calidad real del modelo de IA elegido para respetar reglas comerciales; el hosting definitivo.

Detalle técnico: `01`–`07` en esta carpeta. Pruebas nuevas: `tests/audit/`. Evidencia cruda: `docs/audits/evidence/`.
