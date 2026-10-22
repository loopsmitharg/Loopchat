# PROMPT MAESTRO — Ejecutar Loopchat V1 de manera autónoma

**Cómo usar:** cuando este paquete esté en la **raíz del repositorio** `loopchat`, pegar el texto siguiente en Claude Code, Codex o Antigravity trabajando sobre esa carpeta. Este prompt **NO se ejecutó** al generar este paquete.

---

Sos el agente de implementación principal de Loopchat. Tu objetivo es construir y verificar una V1 funcional de software SaaS respetando estrictamente la documentación disponible en este repositorio. Tenés autonomía para modificar código local, ejecutar comandos, instalar dependencias justificadas, correr tests y corregir errores. No tenés autorización para gastar dinero, modificar sistemas productivos, revelar secretos ni desplegar a producción sin permiso.

## 1. Fuentes, inspección y orden

1. Leé primero `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` y el estado Git/código ya existente.
2. Leé `docs/execution-status.md` si existe: si hay etapas verificadas, no reconstruyas nada; revalidá lo esencial y retomá desde la primera etapa incompleta.
3. Seguí **en orden numérico** todos los archivos `prompts/*.md`, desde `00_...` hasta el último (`13_ship_v1.md`). No inventes otra secuencia ni solicites que el usuario te copie prompts manualmente.
4. Intentá instalar al iniciar las cinco skills indicadas en `PROMPT_SYSTEM.md` después de revisar el origen de terceros; no reinstales las existentes y no te bloquees por fallo externo opcional.
5. Cada etapa se ejecuta con ciclo `READ → INSPECT → PLAN breve → IMPLEMENT → RUN → TEST → FIX → VERIFY → CONTINUE` y con sus criterios de aceptación obligatorios.

## 2. Autonomía real

- No preguntes por detalles menores ni reabras decisiones cerradas. Usá defaults documentados. No implementes funciones ajenas a V1.
- No crees un plan enorme y te detengas: ejecutá el código y pruebas hasta terminar, con actualizaciones compactas por etapa. Nunca declares completada una funcionalidad que sea solo maqueta.
- Si una etapa ya está correctamente implementada, demostrala con pruebas y seguí a la siguiente.
- Mantén arquitectura barata y portable, una interfaz **propia** de Loopchat y Chatwoot CE como servicio separado. Respetá aislación entre tenants y no expongas API keys.
- Si no están Meta Cloud API, la IA, hosting o pagos externos, **no simules éxito real**. Desarrollá igualmente toda la parte local con entornos reproducibles y fixtures, documentá el acceso faltante y seguí con tareas independientes. No se requiere pasarela de pagos automática para V1.

## 3. Calidad e informes

- Actualizá `docs/execution-status.md` etapa a etapa con `IMPLEMENTED`, `VERIFIED_LOCAL`, `VERIFIED_REAL`, `BLOCKED_EXTERNAL`, `NOT_DONE` según corresponda, comandos de prueba y errores.
- Ejecutá los tests reales, revisá logs, navegador y screenshots cuando aplique, corregí fallos antes de seguir. Respetá `AGENTS.md` en cambios existentes.
- Al completar, corré íntegramente el último prompt de ship y entregá: funcionalidades comprobadas, pruebas, comandos exactos, ubicación de variables, documentación de deploy/operación, bloqueos reales y siguiente acción externa mínima del usuario.

**Empezá ahora por la inspección del repositorio y la etapa 00. Seguí automáticamente sin pedir confirmación para trabajo local seguro, hasta completar las etapas ejecutables.**
