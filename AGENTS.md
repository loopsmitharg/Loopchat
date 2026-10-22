# AGENTS.md — Reglas permanentes para agentes de Loopchat

## Jerarquía y conflictos

1. `context.md` determina **qué** es Loopchat, funcionalidad, límites y no-goals.
2. Este `AGENTS.md` determina **cómo** implementar con seguridad.
3. El código existente define las decisiones técnicas ya incorporadas si no contradicen 1–2.
4. `prompts/NN_*.md` determina la tarea de la etapa activa.
5. `ASSETS_AND_ART_DIRECTION.md` determina la dirección visual; dentro de diseño prevalece sobre preferencias genéricas de skills.
6. `PROMPT_SYSTEM.md` determina proceso, skills, stack e informes.
7. Documentación oficial actual sirve para verificar APIs/cambios; no impone rediseño de producto.

Si hay conflicto material, el agente registra la diferencia y selecciona el cambio mínimo coherente; pide información **solo** ante riesgo crítico/imposibilidad demostrable.

## Protección de alcance y trabajo existente

- Antes de tocar código, inspeccionar árbol, README, configs, lockfile, migraciones, tests, commits y estado Git; **no reinitializar ni sobrescribir** trabajo válido.
- No agregar funcionalidades no incluidas en `context.md` ni infraestructura “por si acaso”. No cambiar stack por preferencia o tendencia.
- No reemplazar Chatwoot por otra solución sin prueba objetiva de bloqueo; primero investigar adaptadores de API. No copiar/forkear su frontend.
- No entrar a producción, contratar servicios, gastar dinero, registrar dominios, rotar claves ni modificar cuentas reales sin autorización del usuario. No realizar acciones destructivas en proveedores.
- Hacer commits de cambios coherentes si Git está configurado y autorizado; **no** forzar push ni alterar ramas ajenas.

## Implementación

- Preferir soluciones simples, componentes claros, módulos cohesionados, configuración centralizada, nombres explícitos y dependencias mínimas justificadas.
- Cada endpoint y trabajo asincrónico de datos empresariales exige autorización por tenant y actor. Validar inputs, IDs externos, webhook, tamaño/tipo de archivos y permisos. Nunca confiar solo en filtros del frontend.
- No crear credenciales, API keys ni cuentas ficticias que aparenten ser reales. Secretos solo en servidor, `.env.example` sin valores y `gitignore` efectivo.
- El motor de IA no puede enviar un mensaje si el humano tomó control, el tenant está suspendido, no hay cuota o la política Meta lo impide. Evitar duplicaciones por retries.
- Preferir interfaces/adaptadores finos para Chatwoot, Meta e IA. Consultar documentación de la versión instalada antes de afirmar capacidades.
- No usar TODO/FIXME, mocks persistentes, pantallas decorativas o botones sin acción como sustituto de funcionalidades terminadas. Modo demo claramente etiquetado y separado de producción.

## Autonomía

Elegir sin consultar: convenciones de nombres, espaciado, responsive, tokens internos, pequeños timeouts, nombres de variables, estructura de archivos razonable, mensajes de error, microinteracciones. Registrar decisiones relevantes brevemente en `docs/decisions.md` **solo cuando existan razones de ingeniería a futuro**.

Solo detener la acción externa afectada si faltan claves, permisos o configuración real, se requiere gasto, puede impactar producción o existe riesgo de pérdida de datos. Completar **todo lo independiente** usando pruebas locales/fixtures; dejar bloqueo en estado rastreable, no declarar despliegue real completado.

## QA obligatorio

- Por etapa: `inspect → implement → run → test → fix → verify`; ejecutar lint/typecheck, tests relevantes y comprobación de logs. Sin errores conocidos críticos antes de seguir.
- Cambios UI: verificar con navegador y capturas a 1440 px, 768 px y 390 px cuando haya navegador; revisar contenido realista, legibilidad, navegación por teclado, accesibilidad y acciones.
- Cambios de base: migraciones versionadas y reversión/restore explicada. Cambios de seguridad: test negativo de acceso cruzado tenant A/B.
- Mantener `docs/execution-status.md` actualizado con etapa, comandos ejecutados, evidencia, errores y bloqueos; no marcar `PASS` algo que no se ejecutó.
- Si un test falla: depurar y corregir antes de avanzar; si es imposible por dependencia externa, etiquetar `BLOCKED_EXTERNAL`, aportar test sustituto y continuar solo tareas independientes.

## Finalización

No dar por terminada una etapa con “estructura preparada” cuando exige un flujo funcional. No confundir `dev server iniciado` con V1 desplegada. Comunicar claramente: `IMPLEMENTED`, `VERIFIED`, `BLOCKED_EXTERNAL` y `NOT_DONE`. El último prompt solo permite `SHIPPED` cuando se cumplieron los criterios de V1 y pruebas reales obligatorias.
