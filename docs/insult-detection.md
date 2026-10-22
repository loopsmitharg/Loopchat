# Detección local de insultos y agresiones

**Código:** `src/lib/moderation/detect.ts` (motor) · `src/lib/moderation/lexicons.ts` (diccionarios) · `src/server/flows/policy.ts` (`checkInsult`, `handoffWithPolicy`) · pruebas: `tests/unit/insults.test.ts`, `tests/integration/bot-module.test.ts`.

## Qué hace

Antes de cualquier llamada al proveedor de IA (en cada mensaje nuevo o respuesta a un paso "esperar"), el runtime revisa el mensaje del cliente. Si detecta un insulto o una agresión y el bot tiene activada **"Derivar automáticamente ante insultos o agresiones verbales"** (activada por defecto):

1. **No llama a la IA** y no consume tokens ni cupo del cliente (verificado: 0 requests al proveedor y 0 eventos `ai_calls`).
2. Envía el **mensaje fijo de transferencia** si está configurado (plantilla estática, sin IA).
3. Pasa la conversación a **"Pide humano"** (`attention_mode = requested`): el bot deja de responder y cualquier respuesta pendiente o tardía se descarta (el envío del bot exige `attention_mode = bot` con bloqueo de fila).
4. Asigna el **responsable configurado** si la conversación no tenía uno.
5. Crea una **tarea** "Atender conversación derivada" si "Avisar al equipo" está activo.
6. Registra el motivo con el código **`insult_detection`** en la actividad de la conversación, en la ejecución (métricas) y en el banner que ve el vendedor.

Nada se envía a servicios externos de moderación.

## Cómo detecta (sin IA)

- **Normalización**: Unicode compatible (NFKC: letras de ancho completo, ligaduras), minúsculas, sin tildes, caracteres invisibles eliminados (espacios de ancho cero, guiones suaves, marcas de dirección), homoglifos cirílicos (`іdіоtа`), sustituciones `0→o 1→i 3→e 4→a 5→s 7→t 8→b @→a $→s`, separadores dentro de la palabra (`p.u.t.o`, `h-d-p`), letras espaciadas (`p u t o`, solo si forman un término conocido) y letras repetidas (`boluuudo`).
- **Coincidencia por palabra completa**, nunca por subcadena (evita "computadora", "Scunthorpe"). Plural y cambio de género solo en términos de 5+ letras ("rata" no coincide con "rato").
- **Tres niveles**:
  - `phrases`: insultos compuestos y amenazas ("hijo de puta", "te voy a matar", "fuck off") → derivan siempre.
  - `strong`: palabras ofensivas por sí mismas → derivan salvo negación o cita.
  - `mild`: palabras con otros usos ("burro", "basura", "cerdo", "retrasado", "chorro") → solo derivan si van **dirigidas** a alguien ("sos un …", "you …", "seu …", "du bist …") o si el mensaje es prácticamente solo el insulto.
- **Controles contra falsos positivos**:
  - texto entre comillas = mención, no agresión;
  - negaciones ("no sos un …", "no es ninguna estafa") y verbos de relato ("me dijeron que eran unos chantas") evaluados dentro de la misma cláusula;
  - expresiones seguras ("burro de arranque", "bolsas de basura", "carne de cerdo", "de puta madre", "garbage bag");
  - **títulos del catálogo** de la empresa y **términos a ignorar** configurables por bot;
  - colisiones entre idiomas evitadas (p. ej. el francés "con" solo se usa en frases, porque en español es una preposición).

## Cobertura verificada

Español (rioplatense y general), inglés, portugués, italiano, francés y alemán, con casos de prueba por idioma, variantes de escritura y falsos positivos en `tests/unit/insults.test.ts` (57 casos).

## Límites conocidos (no se promete detección perfecta)

- Otros idiomas no están cubiertos (se pueden agregar como diccionario nuevo en `LEXICONS`).
- Sarcasmo, ironía, insultos creativos o eufemismos no listados no se detectan; la IA puede igualmente pedir una persona si el cliente está molesto ("La IA puede pedir una persona").
- Palabras enmascaradas con asteriscos (`p*to`) no se reconstruyen.
- La frustración con groserías ("¿dónde carajo está mi pedido?") se deriva: es intencional (cliente alterado → mejor una persona).
- Un producto cuyo título sea una sola palabra ofensiva hace que esa palabra se ignore en esa empresa.

## Cómo ampliar sin tocar el núcleo

- Por empresa/bot: **Derivación humana → Términos extra** (se tratan como ofensivos) y **Términos a ignorar**.
- Global: agregar entradas o un idioma en `src/lib/moderation/lexicons.ts` (minúsculas, sin tildes; mild/strong/phrases/safePhrases y señales de dirección, negación y relato) y sumar casos en `tests/unit/insults.test.ts`.
