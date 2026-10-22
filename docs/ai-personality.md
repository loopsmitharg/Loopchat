# Personalidad, objetivos y reglas de los equipos de IA

Fecha: 2026-10-21. Amplía `docs/bot-module.md` y `docs/bot-teams.md`. Todo lo que se configura visualmente se traduce a instrucciones reales con un único motor (`src/lib/instructions/build.ts`), el mismo que usan el runtime, el simulador y la vista "Instrucciones efectivas".

## 1. Auditoría previa (qué había)

- Instrucciones del bot (`bots.instructions`, texto libre) + personalidad básica (`config.personality`: tono, largo, emojis, idioma, bienvenida) traducida por `styleBlock`.
- Reglas de plataforma fijas (`PLATFORM_RULES`) y armado del prompt en `ai-step.ts`; datos (conocimiento, catálogo, memoria) marcados como "no son instrucciones".
- Versiones inmutables con copia de configuración (`bot_versions.settings`).
- No existía identidad/objetivos/reglas a nivel empresa ni jerarquía explícita.

## 2. Empresa: Configuración → Identidad y objetivos de IA

Tablas nuevas (migración `drizzle/0003_ai_profile.sql`, aditiva): `tenant_ai_profiles` (perfil con revisión), `tenant_ai_rules` (reglas con categoría, activa, obligatoria, orden), `ai_personality_templates` (plantillas propias).

- **Identidad empresarial**: descripción, actividad, productos y servicios, público, propuesta de valor, diferenciales, cobertura, idiomas, canales, información comercial. **El nombre y los horarios no se duplican**: se leen de Configuración → Empresa.
- **Objetivo principal + secundarios + explicación propia**. Orienta a todos los bots pero no habilita acciones: si el objetivo es comercial, los bots de soporte, atención, posventa y recepción reciben "aplicá estos objetivos solo dentro de tu función; no vendas durante un reclamo".
- **Reglas generales**: crear, editar, activar/desactivar, categorizar, marcar obligatorias, ver qué bots las heredan, agregar reglas sugeridas (nunca se crean automáticamente). Crear o cambiar una obligatoria requiere permiso de administrador (`settings:write`).
- **Personalidad de marca**: personalidad, formalidad, tratamiento (vos/tú/usted), emojis (como **máximo**), largo sugerido, estilo, expresiones características y prohibidas, saludo y despedida.

## 3. Bot: secciones de configuración

Agrupadas como la incorporación de un empleado (pestañas Configuración/Probar/Ejecuciones/Versiones sin cambios):

| Grupo | Secciones |
|---|---|
| Quién es | Identidad (nombre interno, nombre visible opcional, rol, función, especialización, número, IA) · Objetivos (catálogo por rol, propios, indicadores) · Personalidad y comportamiento · Reglas de comportamiento |
| Qué sabe | Conocimiento (todo o fuentes elegidas = restricción de acceso, memoria) · Productos |
| Qué puede hacer | Herramientas · Pipeline asociado · Datos comerciales |
| Cuándo deriva | Transferencias (equipos, derivaciones entrantes/salientes) · Derivación humana · Horarios y reglas |
| Funcionamiento | Operación (temperatura y tokens solo si el modelo los admite, reintentos, falla, límite de uso) · Instrucciones efectivas |

Personalidad: formalidad (5 niveles), actitud (hasta 3 + matiz), extensión (4), iniciativa (reactivo/consultivo/proactivo), intensidad comercial (5), emojis (4), estilo (6), idioma, responder en el idioma del cliente, trato, uso del nombre, una pregunta por mensaje, expresiones preferidas/prohibidas, terminología. Vista previa orientativa (marcada "no generada por IA") y botón para generar una respuesta real con el modelo.

Nuevo rol **Posventa**. Plantillas de personalidad: Recepcionista cordial, Vendedor consultivo, Soporte técnico, Atención al cliente, Seguimiento comercial, y plantillas propias de la empresa. Ninguna es obligatoria.

## 4. Herencia y prioridad

Orden en el prompt (y en "Instrucciones efectivas"):

1. Reglas de la plataforma (seguridad; además validadas en el servidor: herramientas, etapas, permisos, empresa).
2. Reglas **obligatorias** de la empresa — **en vivo**: rigen al instante en todos los bots, incluso versiones ya publicadas; ningún bot puede desactivarlas (validado en el servidor).
3. Identidad, objetivos y políticas comunes de la empresa — **versionadas**: se copian al publicar cada bot.
4. Coordinación del equipo (si el bot está en un equipo).
5. Rol, objetivos, personalidad, reglas del bot e instrucciones particulares (que se conservan textualmente y pueden precisar el estilo).
6. Datos de la conversación (CRM, conocimiento, catálogo, traspaso, mensaje): menor confianza, nunca instrucciones.

Conflictos resueltos de forma determinística y explicados en la interfaz: actitudes contradictorias (se usa la primera), recepcionista con intensidad comercial (pasa a "sin intención comercial"), soporte/atención persuasivos o muy comerciales (se limita a consultivo, nunca en reclamos), formalidad formal con muchos emojis (uno ocasional), emojis por encima del máximo de la marca, objetivo comercial de la empresa en bots no comerciales, regla común que pasó a obligatoria (no se repite).

Los bots existentes no cambian: si no usan las dimensiones nuevas producen el mismo estilo que antes, y sus versiones publicadas sin copia de la empresa solo suman las reglas obligatorias que la empresa decida crear. No se reescribe ningún prompt existente.

## 5. Derivaciones determinísticas nuevas (sin IA)

- Oportunidad de alto valor (importe ≥ umbral) → `high_value`.
- Error al ejecutar una acción (oportunidad/tarea) → `tool_error` (opcional).
- Límite de llamadas a la IA por conversación → `usage_limit`, antes de llamar al proveedor.
- Mensaje fijo ante fallas y reintentos configurables por bot.
- Condiciones evaluadas por la IA (reclamo complejo, fuera de especialidad, requiere autorización, propias) se agregan a las instrucciones.
- Equipos: mensaje de transición opcional por derivación (por defecto, silenciosa).

## 6. Versionado

Cada versión guarda identidad, personalidad, objetivos, reglas del bot, herramientas, pipeline, operación, la **copia de la política de la empresa** y la versión del motor de instrucciones. Cada ejecución registra la versión del motor y la **huella** de las instrucciones efectivas. En Versiones: comparar dos versiones (o versión vs. borrador) con nombres legibles; en Probar: comparar la respuesta del borrador con una versión publicada. "Publicar en esos bots" aplica la política nueva de la empresa a los bots desactualizados sin otros cambios pendientes (los que tienen cambios sin revisar se informan y no se publican).

## 7. Pruebas

- `tests/unit/instructions.test.ts`: selectores → texto real, compatibilidad con bots existentes, conflictos, vista previa, jerarquía y no duplicación.
- `tests/integration/ai-profile.test.ts`: perfil y reglas por empresa y con permisos, herencia (obligatorias en vivo, comunes al publicar, no desactivables), personalidad y objetivos que llegan al modelo, instrucciones efectivas sin secretos, comparación y restauración de versiones, simulador por versión, derivaciones de alto valor y por límite de uso, conocimiento restringido.
- `tests/e2e/ai-personality.spec.ts` y `mobile.spec.ts`: configuración de empresa, personalidad visual, reglas heredadas, instrucciones efectivas, simulador, comparación y asistente de 8 pasos; axe y sin overflow.

## Limitaciones reales

- La vista previa es orientativa (plantillas de frases); la respuesta real depende del modelo: se puede generar con el botón "Generar una respuesta real" (consume una llamada).
- La IA simulada del simulador no "habla" con la personalidad: indica qué estilo recibió en las instrucciones. Para evaluar el tono real hay que usar el proveedor real.
- La compatibilidad de parámetros se conoce para OpenAI oficial, Anthropic y Gemini; en otros proveedores compatibles se intenta y, si el proveedor lo rechaza, se omite.
- Las reglas evaluadas por la IA (reclamo complejo, fuera de especialidad) dependen del modelo; las determinísticas no.
