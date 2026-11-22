# 09 — Todo Trabajo: equipo multiagente en Loopchat

Fuente única: `informacion-empresarial-y-comercial.md` (repo TodoTrabajo), leído completo. Configuración **persistida en la base local** con los servicios reales de Loopchat mediante `scripts/setup-todo-trabajo.ts` (idempotente: una segunda corrida no duplica nada ni crea versiones si no hubo cambios). Datos en `scripts/lib/todo-trabajo-data.ts`.

```powershell
$env:TODO_TRABAJO_DOSSIER="..\TodoTrabajo\docs\informacion-empresarial-y-comercial.md"; npx tsx --conditions=react-server scripts/setup-todo-trabajo.ts
```

## 0. Análisis del dossier

- **Públicos:** candidatos (buscan empleo, Premium, CV), profesionales independientes (directorio), empresas y reclutadores (B2B).
- **Servicios con precio en el dossier:** Premium 1/3/9 meses; packs de 4/6/10 créditos. **Sin precio:** escaneo ATS, armado de CV, LinkedIn, B2B, canal de difusión → el bot dice que se consulta.
- **Datos que necesitan verificación dinámica (el bot no los tiene):** vacantes activas, saldos de créditos y puntos, referidos acreditados, pagos y suscripciones, aprobación de empresas, perfiles y ofertas.
- **Decisiones humanas:** pagos/acreditaciones, canjes y transferencias de dinero, descuentos, reintegros, aprobación/moderación, propuestas B2B, cualquier operación administrativa.
- **No cargado a propósito:** §7 (campañas y segmentos) y §8 (métricas de backoffice) son información interna. Sitio web, correos, teléfonos, domicilios y horarios no figuran: no se inventaron.

## 1. Empresa

Creada con el alta real de empresas (`createTenant`, plan **Pro**: 15 bots activos, pipelines ilimitados), id `de9f55d2-…`, identificador `todo-trabajo`. No existía otra "Todo Trabajo". Administradora local `admin@todotrabajo.localhost` (dominio reservado, no real) creada aceptando la invitación real; contraseña aleatoria solo en `storage/todo-trabajo-admin.local.txt` (ignorado por Git). Zona horaria America/Argentina/Buenos_Aires, moneda ARS, sin horario (no lo informa el dossier). Cuenta propia en Chatwoot (id 6) con webhook firmado. Otras empresas: sin cambios.

Identidad de IA (Configuración → Identidad y objetivos de IA): descripción, actividad "Empleabilidad, reclutamiento y servicios profesionales", oferta, públicos, propuesta de valor, diferenciales, cobertura "Argentina (24 jurisdicciones) y modalidades remotas o híbridas", idioma español, canales Instagram/TikTok @todotrabajo.ar y Facebook "Todotrabajo Ar". Marca: profesional y cercana, **vos**, emojis moderados, respuestas breves; expresiones a evitar ("trabajo asegurado", "100% garantizado"…).

## 2. Objetivos generales

Principal: *Brindar atención al cliente* con la declaración literal pedida ("Brindar atención rápida, clara y personalizada…"). Secundarios: captar clientes, calificar oportunidades, aumentar ventas y uno personalizado ("Derivar correctamente a humanos y reducir consultas repetitivas").

## 3. Reglas generales (13 obligatorias, heredadas en vivo por los 7 bots; ningún bot puede desactivarlas)

No inventar precios (solo catálogo, valores de lista sujetos a actualización) · no inventar descuentos (solo canjes de puntos, nunca desde el chat) · no prometer empleo, entrevistas ni contrataciones · no afirmar vacantes/empresas/salarios · no inventar saldos de créditos o puntos ni referidos acreditados · no confirmar pagos, activaciones, canjes ni transferencias (registrar y derivar) · no afirmar postulaciones, publicaciones o análisis de CV · no modificar suscripciones, créditos, puntos, pagos o reintegros · nunca pedir contraseñas, códigos, CBU, tarjeta, DNI, CUIL ni salud (y pedir que no se compartan) · no pedir el CV por WhatsApp (se carga en la Suite CV) · no revelar datos de terceros ni internos · derivar a una persona cuando se pide o se requiere una operación administrativa · voseo, brevedad y sin presión; si no se sabe, decirlo.

Además, en cada bot: detección local de insultos (sin IA), palabras de derivación (frases completas), "pausar la IA cuando interviene una persona" (invariante), reactivación **solo manual**, tarea al equipo al derivar, mensaje fijo de derivación.

## 4–6. Bots creados (publicados, versión 2)

| Bot | Rol | Personalidad (config) | Objetivos | Herramientas | Conocimiento | Catálogo | Pipeline |
|---|---|---|---|---|---|---|---|
| **Recepción Todo Trabajo** (entrada) | Recepcionista | Profesional y cercano, amable, **muy breve**, iniciativa proactiva, intensidad comercial *ninguna*, emojis ocasionales, una pregunta a la vez | Identificar necesidad, clasificar, derivar, no repetir preguntas | clasificar, conocimiento, derivar (crear/mover oportunidades **bloqueado por rol**) | Institucional | — | nunca crea |
| **Asesor de Empleos** | Atención | Empático, motivador, paciente, conversacional, sin vender | Resolver, derivar; "explicar cómo buscar y postularse sin inventar vacantes" | clasificar, conocimiento, catálogo, derivar | Empleos (+ canal de difusión), Premium (comparativa) | Canal de Difusión | **nunca crea** |
| **Asesor Premium y Beneficios** | Ventas | Consultivo, entusiasta sin exagerar, explicativo, emojis moderados | Entender, responder con datos reales, recomendar, registrar oportunidad, pasar a vendedor | + crear oportunidad, mover etapa (solo hacia adelante), tarea | Premium, Referidos | Premium 1/3/9 | A |
| **Especialista en CV e IA** | Ventas | Técnico, calmo, didáctico, respuestas equilibradas | Ídem ventas | ídem Premium | CV/ATS/IA | 3 packs + 7 servicios/módulos | C |
| **Asesor de Empresas** | Ventas (B2B) | Formal moderado (vos), serio/cordial, directo | Entender, **calificar**, registrar oportunidad, pasar a vendedor | clasificar, conocimiento, derivar, oportunidad, etapa, tarea | Empresas B2B | — (no hay precios B2B) | B |
| **Asesor de Profesionales** | Atención | Cercano, práctico, directo, sin vender | Resolver, derivar; "explicar directorio y moderación" | clasificar, conocimiento, derivar | Directorio (32 rubros) | — | **nunca crea** |
| **Atención y Soporte Todo Trabajo** | Atención | Muy paciente, empático, calmo, reactivo, sin presión comercial | Resolver, identificar el problema, registrar reclamo, crear caso, derivar | clasificar, conocimiento, derivar, tarea, caso (oportunidad en D) | Premium, CV, Empleos, Empresas, Profesionales, Referidos | — | D (casos, no ventas) |

Comunes: español, responder en el idioma del cliente, memoria comercial activa, nombre del bot oculto (experiencia continua), fuera de horario = responder (no hay horario cargado), máximo 2 consultas seguidas sin resolver → persona, temperatura 0,3, máx. 350 tokens por respuesta, 2 reintentos y luego persona, **límites de consumo**: 30 llamadas a IA por conversación y 40 por contacto en 24 h. Cada bot tiene además instrucciones propias y listas "hacer / no hacer" (ver `scripts/lib/todo-trabajo-data.ts`).

## 7. Conocimiento

7 documentos de texto (Configuración → Conocimiento), cada uno con el **texto literal** de las secciones del dossier (se extraen por título; si el dossier cambia, el script reemplaza el documento): Institucional (§ inicial + §1), Premium (§2.1), CV/ATS/IA (§2.2–2.3), Empleos (§2.4 + §3), Empresas (§4), Profesionales (§5), Referidos (§6, con todas las tablas de puntos, descuentos y transferencias). Cada bot accede **solo** a sus fuentes (modo "seleccionadas").

## 8. Catálogo y precios (14 productos, stock **sin informar** — nunca 0, sin fotos)

| Producto | Precio (ARS) |
|---|---|
| Premium 1 mes | 2.995 |
| Premium 3 meses | 6.000 |
| Premium 9 meses | 9.000 |
| Pack Inicial — 4 créditos | 5.000 |
| Pack Intermedio — 6 créditos | 7.000 |
| Pack Avanzado — 10 créditos | 10.000 |
| Servicio: Escaneo y Diagnóstico de CV (ATS) · Armado de CV ATS · Optimización de LinkedIn | sin precio (se consulta) |
| Suite CV: ATS Check (sin costo de créditos) · CV Quality & Job Match (1 crédito) · CV Harvard (5 créditos, requiere CV Quality) · Carta de presentación (1 crédito) | sin precio en ARS (se pagan con créditos) |
| Canal de Difusión de Empleos | sin precio |

Los precios viven en el catálogo: cambiarlos ahí se refleja al instante en las respuestas (no hay que republicar).

## 9. Pipelines (estructuras internas de Loopchat, no estados de Todo Trabajo)

Se inspeccionó primero: la empresa tenía solo el inicial "Ventas" vacío, que se **renombró** (no se duplicó).

| Pipeline | Etapas | Lo usa |
|---|---|---|
| A · Consultas comerciales Premium | Nuevo interesado → Informado → Interés de compra → Requiere humano → Ganado / Perdido | Premium |
| B · Empresas B2B | Nuevo contacto → Calificación → Propuesta → Requiere humano → Ganado / Perdido | Empresas |
| C · Servicios de CV y Carrera | Nuevo interesado → Orientado → Interés en servicio → Requiere humano → Ganado / Perdido | CV e IA |
| D · Atención y Soporte | Nuevo caso → En revisión → Requiere humano → Esperando al usuario → Resuelto / Sin resolución | Soporte |

Los bots solo pueden mover entre etapas abiertas de su pipeline (nunca ganada/perdida). Las etapas del Mini-ATS (Enviada, En Entrevista, Contratado, Rechazado) se explican como proceso de la empresa y no se mezclan con B. Con el equipo activo no se crea una oportunidad automática por cada mensaje (`autoCreateOpportunity` desactivado).

## 10. Herramientas autorizadas

Las del cuadro anterior. **No existe** ninguna herramienta para modificar puntos, saldos, créditos, pagos o suscripciones: el modelo no puede ejecutar esas acciones aunque lo intente (Loopchat solo ofrece oportunidad, etapa, tarea, derivación, clasificar, conocimiento, catálogo y datos comerciales). Los intentos no permitidos quedan registrados como bloqueados (S06, S16).

## 11. Equipo y derivaciones

**Equipo de Atención — Todo Trabajo**, publicado (versión 2) y **activo**, "para todos los números" (no hay número conectado). 43 derivaciones por **palabras clave** (sin IA):

- Recepción → (en este orden) Persona · Soporte (problemas, pagos, contraseñas, DNI/CBU) · Empresas · Profesionales · Premium/referidos · CV/créditos · Empleos.
- Cada especialista → Persona, Soporte y los demás especialistas con frases inequívocas (conjuntos disjuntos por destino: no hay ciclos con la misma palabra).
- Soporte solo sale con un pedido comercial explícito ("quiero suscribirme", "busco trabajo"…): un reclamo que menciona Premium sigue en Soporte.
- Sin coincidencia: la recepción pregunta (con IA real, clasifica con la IA de la empresa entre estas derivaciones). Máximo 2 derivaciones seguidas; bot no disponible → recepción; bucle → persona. Un solo bot activo por conversación; la derivación a persona detiene a todo el equipo y no hay retoma automática. Contexto compartido: historial y resumen de traspaso (sin repetir preguntas).

## 12. Versiones publicadas

7 bots en **v2** (v1: configuración inicial; v2: `onFailure` = derivar con un solo mensaje). Equipo **v2** (fija la v2 de cada bot).

## 13. Resultados del simulador — 19/19 PASS

Motor real de Loopchat (`simulateTeam`, versiones publicadas) con **IA SIMULADA** (determinista). Verifica enrutamiento, derivaciones, herramientas, pipelines, bloqueos y qué conocimiento/catálogo recibiría la IA. **No** verifica la redacción de un modelo real. Evidencia: `evidence/todo-trabajo-simulations.json`.

| # | Mensaje | Camino | IA | Resultado clave |
|---|---|---|---|---|
| S01 | Busco trabajo en administración en Córdoba | Recepción → Empleos | sí | sin oportunidad; conocimiento de ofertas recuperado |
| S02 | ¿Cuánto sale el Premium de tres meses? | → Premium | sí | catálogo provisto: "Premium 3 meses — 6000" |
| S03 | ¿Mi currículum pasa un filtro ATS? | → CV e IA | sí | conocimiento ATS recuperado |
| S04 | ¿Cuántos créditos para un CV Harvard? | → CV e IA | sí | catálogo "CV Harvard (5 créditos)" + conocimiento "Requiere haber completado previamente CV Quality" |
| S05 | Tengo una empresa y quiero publicar una búsqueda de personal | → Empresas | sí | la IA simulada deriva por "personal" (artefacto del simulador) |
| S05b | … publicar una oferta para un puesto administrativo en Rosario | → Empresas | sí | oportunidad simulada en **B · Empresas B2B / Nuevo contacto** |
| S06 | Soy electricista y quiero ofrecer mis servicios | → Profesionales | sí | `create_opportunity` **bloqueado** (no habilitado) |
| S07 | Invité a un amigo, ¿cuántos puntos tengo? | → Premium y Referidos | sí | conocimiento "180 días"; ningún saldo disponible para la IA |
| S08 | Pagué Premium y no me figura activo | → Soporte | sí | sin oferta comercial |
| S09 | Quiero hablar con una persona | → **persona** | **no** | derivación inmediata, sin IA |
| S10 | Mejorar mi CV → contratar personal para mi empresa | CV e IA → **Empresas** | sí | transferencia por palabra clave en el 2.º mensaje |
| S11 | ¿Me das 80% de descuento? | → Premium | sí | **respuesta retenida** por la guardia comercial ("descuento no autorizado: 80%") → persona |
| S12 | Si pago Premium, ¿me aseguran trabajo? | → Premium | sí | regla obligatoria "no prometer empleo" en el prompt |
| S13 | Te mando DNI, CBU y contraseña | → Soporte | sí | Soporte con regla de datos sensibles |
| S14 | Insulto | → persona | **no** | detección local, sin IA |
| S15 | Me cobraron dos veces el Premium | → Soporte | sí | caso en **D · Atención y Soporte**, no venta |
| S16 | Premium 9 meses, marcá la venta como ganada | → Premium | sí | oportunidad en A; mover a "Ganado" **bloqueado** |
| S17 | Persona → "¿Siguen ahí?" | persona | no | **ningún bot vuelve a responder** |
| S18 | Hola | Recepción | sí | se queda en recepción, sin oportunidad |

Observaciones honestas: la IA simulada marca "compra" cualquier mensaje con "quiero", por eso aparecen oportunidades en S03/S10 (C) y S16 (A); con un modelo real la política "solo con intención de compra concreta" decide. La consulta de empleo (S01) y la de profesionales (S06) **no pueden** crear oportunidades (herramienta quitada). Ningún reclamo terminó en un pipeline comercial.

Prueba E2E real (Chatwoot + worker, sin Meta): ver `06_TEST_RESULTS.md` §C.

## 14. Errores encontrados (y corregidos)

Derivaciones duplicadas por par de nodos (la validación lo rechaza) → una sola por par. Palabras de derivación comparadas por subcadena ("humano" ⊂ "recursos humanos") → frases completas. Doble mensaje al fallar la IA → `onFailure: handoff`.

## 15. Limitaciones

- **Sin IA real**: los bots apuntan a la conexión "Simulador de IA local (NO es IA real)" (necesaria para publicar). En el runtime real esa URL privada está bloqueada, así que cada especialista **deriva a una persona** en vez de responder. Con una clave real: ver `08_NEXT_STEPS.md`.
- La clasificación sin IA usa palabras clave en español: mensajes atípicos se quedan en la recepción (pregunta) hasta tener IA real.
- No hay horario de atención ni "canal seguro" para datos sensibles definidos en el dossier: el bot pide no compartirlos y deriva, pero no puede indicar un canal oficial.
- No se configuraron "datos comerciales a recolectar" (campos de lead): el dossier no define cuáles; Empresas califica en la conversación y lo registra en la oportunidad.
- No hay integración con la plataforma de Todo Trabajo: no se consultan vacantes, cuentas, puntos ni pagos (los bots lo explican y derivan).
- Capturas de pantalla de la UI no tomadas (no se cambió código de interfaz; la verificación fue por API autenticada).

## 16. WhatsApp real

**No conectado** (BLOCKED_EXTERNAL: faltan credenciales de Meta). El equipo está publicado y activo para todos los números: al conectar el número de prueba en Todo Trabajo empieza a atender sin más cambios. Los bots **no** están respondiendo por WhatsApp; solo se probaron en el simulador y por la bandeja API de Chatwoot.

## Cuadro de verificación

| Componente | Estado |
|---|---|
| Empresa Todo Trabajo | VERIFIED (creada con el alta real, persistida, aislada: acceso cruzado → 404) |
| Reglas generales | VERIFIED (13 obligatorias, heredadas por los 7 bots) |
| Recepcionista | VERIFIED (publicado v2; sin herramientas de venta; S18) |
| Bot Empleos | VERIFIED en simulador (S01) · respuesta con IA real: BLOCKED_EXTERNAL |
| Bot Premium | VERIFIED en simulador (S02, S07, S11, S12, S16) · IA real: BLOCKED_EXTERNAL |
| Bot CV e IA | VERIFIED en simulador (S03, S04, S10) · IA real: BLOCKED_EXTERNAL |
| Bot Empresas | VERIFIED en simulador (S05, S05b, S10) · IA real: BLOCKED_EXTERNAL |
| Bot Profesionales | VERIFIED en simulador (S06) · IA real: BLOCKED_EXTERNAL |
| Bot Soporte | VERIFIED en simulador (S08, S13, S15) · IA real: BLOCKED_EXTERNAL |
| Equipo multiagente | VERIFIED (v2 activo; simulador 19/19; E2E real con Chatwoot: derivaciones y persona) |
| Catálogo | VERIFIED (14 productos, precios del dossier, stock sin informar) |
| Conocimiento | VERIFIED (7 documentos literales, por bot) |
| Pipelines | VERIFIED (A–D, sin duplicados) |
| Simulaciones | VERIFIED con IA simulada (19/19) · con modelo real: BLOCKED_EXTERNAL |
| WhatsApp real | BLOCKED_EXTERNAL (sin credenciales de Meta) |
