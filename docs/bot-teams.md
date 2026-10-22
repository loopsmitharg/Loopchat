# Equipos de chatbots (multiagente) integrados con pipelines

Fecha: 2026-10-21. Amplía el módulo de chatbots (`docs/bot-module.md`) sin reemplazarlo: mismo intérprete de flujos, mismas versiones inmutables por bot, mismo camino de salida (Chatwoot), misma IA por empresa (BYOK) y Chatwoot CE separado.

## Modalidades ("Tipo de atención")

| Modalidad | Qué es | Dónde |
|---|---|---|
| Chatbot individual | Un bot atiende todo el número (comportamiento anterior, sin cambios). | `/chatbots` → pestaña **Mis chatbots** |
| Equipo de chatbots | Varios bots especializados; uno de entrada (normalmente la recepcionista) deriva al indicado. | `/chatbots?tab=equipos`, asistente `/chatbots/equipos/nuevo`, detalle `/chatbots/equipos/[id]` |

Precedencia por número: el equipo/bot asignado específicamente al número gana sobre uno "para todos los números"; a igual alcance, el equipo activo gana sobre el bot individual.

## Modelo de datos (migración `drizzle/0002_bot_teams.sql`, aditiva)

- `bots.role`: `receptionist | sales | customer_service | support | followup | custom` (por defecto `custom`: los bots existentes no cambian). El rol se copia a la versión publicada.
- `bot_teams`: borrador del grafo (`draft_graph`, `draft_revision` con control optimista), estado, número, versión publicada.
- `bot_team_versions`: grafo inmutable + **versión publicada de cada bot fijada** (`bot_versions: {botId: botVersionId}`) + checksum.
- `bot_team_members`: bots de la versión publicada (cupos y consultas).
- `bot_transfers`: registro trazable de cada derivación (origen, destino, humano, tipo, necesidad, motivo, ejecución, versión del equipo).
- `conversations.team_id / team_version_id / active_bot_id`: la conversación queda **fijada** a la versión del equipo con la que empezó y tiene **un solo bot activo**. El bot activo es distinto del responsable humano (`assignee_user_id`).
- `opportunities.product_ids`: productos del catálogo referenciados por la IA.
- `bots.config.pipeline` (sección nueva, con valores por defecto): pipeline principal y adicionales, etapa inicial, cuándo crear oportunidades (`purchase_intent | any_inquiry | never`), mover etapas (`allowed_any | forward_only`), etapa de cotización, responsable por defecto y acciones al recibir una derivación.

## Motor de orquestación

Archivos: `src/lib/team/route.ts` (puro, compartido con el simulador), `src/lib/team/intent.ts`, `src/server/teams/orchestrator.ts`, `src/server/flows/trigger.ts`, `src/server/flows/runtime.ts`.

Por cada mensaje entrante de una conversación de equipo:

1. **Insultos primero** (detección local, sin IA): pasa a una persona y suspende a todo el equipo.
2. **Derivación**: palabras clave → necesidad detectada sin IA (`classifyIntent`, con prioridad soporte > atención > turnos > seguimiento > ventas: *un reclamo que menciona un precio no es una venta*) → IA de la empresa solo si las reglas no alcanzan (bot de entrada/recepcionista, o conexiones de tipo "IA"), con reserva de cupo y salida JSON validada.
3. Encadenamiento solo con reglas; protecciones: **límite de derivaciones seguidas** (`maxConsecutiveTransfers`, la racha se reinicia cuando un bot responde), **bucles** (bot ya visitado en el mismo mensaje → persona), **bot no disponible** (eliminado, deshabilitado o fuera de la versión fijada → bot de entrada o persona según la regla), **necesidad no identificada** (el bot de entrada pregunta o pasa a persona).
4. Persistencia: filas en `bot_transfers`, actividad `bot_transfer`, `active_bot_id` actualizado con **UPDATE condicional** (si otro proceso lo cambió, la ejecución se cancela sin responder), resumen estructurado del traspaso en `bot_state.transfer` (sin llamadas extra a la IA: quién derivó, motivo, necesidad, último mensaje, datos comerciales conocidos, productos consultados).
5. La **misma ejecución** pasa al bot destino con su versión fijada y arranca su flujo; el prompt incluye "TRASPASO INTERNO" (no se presenta de nuevo, no repite preguntas). No se envía ningún aviso automático de cambio de bot.
6. Acciones al recibir (configurables en el bot destino): asegurar oportunidad en su pipeline, asignar su responsable por defecto (solo si no hay).

Garantías: un solo bot activo; el envío del bot exige `attention_mode = bot` **y** `active_bot_id = bot` con bloqueo de fila (respuestas tardías descartadas); webhooks duplicados no duplican ejecuciones (clave por mensaje); los reintentos no vuelven a derivar (`metrics.routed`) ni duplican oportunidades (bloqueo `pg_advisory_xact_lock` por contacto+pipeline); todo filtrado por empresa.

## Pipelines

- Cada bot opera en sus pipelines autorizados; las etapas que ve el modelo son solo las permitidas (abiertas, configuradas, y hacia adelante si así se definió). **Nunca ganada/perdida.**
- Oportunidad única **por contacto y pipeline** (soporte puede tener su caso en un pipeline de soporte mientras ventas tiene la suya en el principal). No hay módulo de tickets: los casos de soporte se manejan como oportunidades en un pipeline propio.
- La recepcionista nunca crea ni mueve oportunidades (se quita en el servidor al guardar y en el runtime; la validación del equipo lo marca como error).
- Con un equipo activo, la creación automática de oportunidades al recibir el primer mensaje (`autoCreateOpportunity`) **se omite**: las crean los bots según sus reglas (de lo contrario un reclamo terminaría como venta).
- Estado de la conversación (bot / pide humano / humano / pausado) ≠ etapa comercial.

### Automatizaciones por eventos del pipeline

En `bot_team_versions.graph.automations`. Disparadores: *la oportunidad llega a una etapa*, *la oportunidad se cierra* (ganada/perdida, en un pipeline o en cualquiera). Acciones: *pasar la conversación a un bot*, *detener el bot* (queda "pausado"), *asignar responsable* (si no tiene). Se encolan en la misma transacción que el cambio de etapa (`team.automation`) y nunca retoman una conversación en manos de una persona.

## Validaciones antes de publicar

`src/lib/team/validate.ts` (servidor; el editor muestra los mismos mensajes): bot de entrada válido y habilitado, bots inexistentes o sin versión publicada, bot repetido, conexiones a nodos inexistentes, condiciones vacías, derivaciones duplicadas, el nodo humano no deriva a bots, **bucles irresolubles** (ciclos con la misma necesidad o palabra clave), pipelines/etapas eliminados o de pipelines no autorizados, recepcionista con herramientas de venta, automatizaciones con referencias inválidas. Advertencias: bots inalcanzables o deshabilitados.

## Versiones y conversaciones en curso

Publicar crea una versión inmutable que fija la versión publicada de cada bot. **Política:** cada conversación conserva la versión del equipo con la que empezó hasta que se resuelve (al resolverse se libera la fijación); las conversaciones nuevas usan la versión vigente. "Recuperar como borrador" restaura una versión (quita bots que ya no existen). Desactivar o eliminar un equipo devuelve sus conversaciones a la selección normal.

## Control humano

Derivar a una persona (nodo "Atención humana", insultos, IA, límite de derivaciones, bot no disponible) detiene a **todo el equipo**. No hay retoma automática. Reanudar es explícito: en Conversaciones, "Reanudar equipo" con el bot elegido (registro `manual`). La cabecera muestra "Equipo · Bot activo" separado del responsable.

## Interfaz

- `/chatbots`: pestañas **Mis chatbots / Equipos de chatbots**; "Nuevo" pregunta el **tipo de atención** con explicación. Crear un bot individual permite elegir rol (plantilla editable: instrucciones, herramientas y reglas distintas por rol).
- Asistente guiado de 8 pasos (datos, roles, bots nuevos o existentes, proveedor de IA, pipelines, derivaciones sugeridas, atención humana, revisar): crea y publica los bots nuevos, crea y publica el equipo; queda **inactivo** hasta probarlo.
- Editor visual (React Flow, misma base que el editor de flujos) con vista de lista accesible: nodos con nombre, rol, estado, pipeline, conexiones e indicador de incompleto; derivaciones con condición editable; autoguardado con control de revisión.
- Pestañas del equipo: Equipo, Configuración (datos, reglas, automatizaciones), Probar (simulador multiagente: chat + actividad: bot activo, anterior, necesidad y señales, motivo, IA/tokens, herramientas, pipeline, etapa simulada, acciones y bloqueos), Derivaciones (registro), Versiones.
- Bot: nueva sección **Pipeline asociado** y rol en General.

## Pruebas

- `tests/unit/team-route.test.ts`: intención sin IA (reclamo con precio ≠ venta), motor (reglas, IA solo si hace falta, límite, bucles, no disponible, sin destino), validación, productos/cotización.
- `tests/integration/bot-teams.test.ts` (contra simuladores de Chatwoot e IA): bot individual sin cambios; recepcionista→ventas sin IA de clasificación y con contexto; reclamo→soporte sin oportunidad; ventas→soporte y soporte→ventas con historial y un solo bot activo; pipeline correcto por bot; etapas autorizadas/no autorizadas y recepcionista sin oportunidades; derivación a persona + reanudación manual eligiendo bot; insultos sin IA; bot deshabilitado y sin destino; bot activo no disponible → entrada; límite de derivaciones; webhook duplicado y mensajes simultáneos; respuesta tardía descartada; aislamiento entre empresas; simulación sin cambios reales; versiones con conversación en curso; validación; cupos; automatizaciones.
- `tests/e2e/bot-teams.spec.ts`: asistente, editor (lienzo y lista), simulador multiagente sin efectos, configuración, versiones, sección Pipeline asociado; axe sin violaciones graves y sin overflow.

## Limitaciones reales

- Verificado contra simuladores de contrato (Chatwoot e IA): falta probar con Chatwoot, Meta y un proveedor de IA reales (calidad de la clasificación por IA y de las respuestas con traspaso).
- La detección de necesidades sin IA usa listas de frases (español con algo de inglés/portugués): mensajes atípicos pueden requerir la IA o una regla de palabras clave.
- Dos mensajes simultáneos: como en los bots individuales, el segundo no dispara otra ejecución mientras la primera está en curso (el bot lo ve en el historial al responder); no se responde dos veces.
- El cupo de bots activos cuenta cada bot una vez (individual o en equipo activo); planes con 1 bot activo no pueden activar equipos.
