# Etapa 08 — Conocimiento documental, tareas y automatizaciones comerciales

> **Preflight obligatorio:** leer `context.md`, `AGENTS.md`, `PROMPT_SYSTEM.md`, `ASSETS_AND_ART_DIRECTION.md` (priorizar secciones pertinentes), y **después inspeccionar la implementación actual**. Leer `docs/execution-status.md` si existe. No duplicar especificaciones aquí.

**Objetivo:** completar capacidad de bots y seguimiento sin expandirse a un orquestador universal.

**Inspeccionar antes:** flujo bot, entidades tareas/contactos y política de archivos; verificar las capacidades reales de proveedores de documentos.

**Implementar:** administrar FAQs y fuentes de texto TXT/MD, PDF textuales con extracción validada, tamaños/tipos restringidos, almacenamiento segregado y búsqueda básica; mostrar fuentes cargadas/fallidas y permitir eliminar. Crear tareas/recordatorios simples con vencimientos, asignado y enlaces a negocio/contacto. Nodos/acciones comerciales existentes usan estas fuentes y tareas con permisos; reintentos seguros, cola/wait durables donde haga falta. Actualizar docs con límites de extracción, formatos e historial.

**No tocar:** OCR, vector DB compleja, búsqueda global entre tenants, email marketing o n8n SaaS.

**Aceptación:** doc válido incorporado y buscable solo dentro del tenant; PDF imagen/no extraíble falla explícitamente, archivo inválido rechazado; bot consulta FAQ y crea tarea bajo permisos; tareas completables. Tests de archivos peligrosos/tamaño/ACL y runtime wait/retry; build.

**Cierre obligatorio:** ejecutar/verificar tests afectados, corregir errores, actualizar `docs/execution-status.md` con comandos/resultados y decisiones reales, y continuar con la siguiente etapa si todos los criterios pasan. Si falta dependencia externa, registrar `BLOCKED_EXTERNAL` y seguir solo trabajo seguro independiente.
