# 09 — Informe para los fundadores de Loop Smiths

**Fecha:** 5 de noviembre de 2026 · **Trabajo en la rama** `fix/loopchat-production-readiness` (no fusionado a `main`, nada desplegado, producción sin tocar).

## En una frase
Corregimos todo lo que se podía corregir sin cuentas externas: Loopchat ya no pierde mensajes, atiende varias empresas en paralelo, no hace acciones comerciales indebidas cuando una persona toma el chat, no envía respuestas rotas ni descuentos inventados, y tiene backups y alertas que funcionan. **Lo que falta es conectar un número real de WhatsApp y probar con la IA real que usará cada cliente.**

**Nota: 6,0 → 7,0 / 10** (el cálculo da 7,25; la regla de la auditoría limita a 7 mientras WhatsApp no se pruebe de verdad).

| Área | Antes | Ahora |
|---|---:|---:|
| CRM y WhatsApp | 6 | 7 |
| Chatbots e IA | 6 | 7 |
| Seguridad | 7 | 8 |
| Estabilidad | 6 | 8 |
| Infraestructura | 4 | 6 |

## Qué cambió
- **Mensajes seguidos:** si el cliente escribe "hola" y enseguida "quiero un asesor", ahora se deriva al instante y el bot no responde encima. Antes el segundo mensaje se perdía.
- **Varias empresas a la vez:** 40 conversaciones simultáneas pasaron de 14 s a menos de 3 s, y una empresa lenta ya no hace esperar a las demás.
- **Persona al mando:** cuando un vendedor toma el chat, el bot no crea tareas ni oportunidades después.
- **Respuestas seguras:** el bot ya no puede enviar texto técnico roto, ni descuentos, precios, stock, plazos o "compra confirmada" que la empresa no haya cargado: en ese caso pasa a una persona.
- **Sin cobros duplicados:** un reintento ya no vuelve a llamar a la IA ni duplica tareas.
- **Seguridad:** cerramos los 3 problemas de severidad media (direcciones internas, envíos gigantes al punto público, nombre de perfil usado para manipular al bot), endurecimos los límites de intentos de login y una empresa suspendida ya no puede operar por ningún camino.
- **Plantillas de WhatsApp:** un agente puede reabrir conversaciones de más de 24 h desde Loopchat.
- **Operación:** backups diarios cifrados con copia externa verificada y prueba de restauración real; monitor con alertas; integración continua lista para GitHub.
- **Chatwoot real:** lo instalamos y probamos de verdad (versión 4.19). Todo el circuito con Chatwoot funcionó 10/10, incluido un hallazgo importante: Chatwoot solo envía avisos a una dirección pública de Loopchat (ya está documentado; con la configuración vieja no hubieran llegado mensajes).

## Pruebas
- 270 pruebas automáticas: todas pasan (antes 209).
- 27 pruebas de navegador: todas pasan en la primera corrida.
- 50 conversaciones simuladas: 49 bien y 1 que solo se puede confirmar con IA real (antes 41 bien, 5 mal).
- Intentos de una empresa de ver datos de otra, sobre la versión de producción: 12/12 bloqueados.
- Chatwoot real: 10/10.

## Qué falta para conectar el primer cliente
1. **Número de prueba de Meta** (cuenta de WhatsApp Business, número, token y una plantilla aprobada) y un **servidor de prueba con dominio y HTTPS** para Chatwoot. Con eso corremos los 12 pasos de validación real (1–2 días).
2. **Una clave de IA de prueba** con tope de gasto (USD 5–10) del proveedor que vaya a usar el cliente, para confirmar que el modelo respeta las reglas.
3. **Un bucket** para las copias de seguridad y **un canal de alertas** (Slack, Discord o email).
4. **Subir la rama a GitHub** para que corra la integración continua.

## Respuestas directas
1. **¿Podemos conectar un cliente real?** Todavía no: primero el paso 1 con un número de prueba. Es el único camino crítico que no se pudo probar de punta a punta.
2. **¿Podemos iniciar un piloto?** Sí, con 1–2 clientes de confianza, apenas pasen los pasos 1–4 (≈ 3–6 días de trabajo más los tiempos de Meta).
3. **¿Podemos comercializar?** No todavía: después de un piloto de 2 semanas sin incidentes graves, una prueba de carga con WhatsApp e IA reales y una revisión de seguridad externa.
4. **¿Qué falta exactamente?** Los 4 puntos de arriba y luego lo listado en `08_REMAINING_BLOCKERS.md`.
5. **Mayor riesgo:** que WhatsApp real (entregas, estados, plantillas, validaciones de Meta) se comporte distinto de lo probado.
6. **Nota:** 7,0/10. Piloto controlado posible, sujeto a completar la validación con Meta.
