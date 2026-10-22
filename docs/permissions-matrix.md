# Matriz de permisos V1

Fuente única en código: `src/lib/permissions.ts` (probada en `tests/unit/permissions.test.ts` y en tests de integración/E2E con casos negativos). La autorización **siempre** se evalúa en el servidor; la UI solo oculta acciones.

| Permiso | tenant_admin | manager | agent | viewer | bot (allowlist) |
|---|:-:|:-:|:-:|:-:|:-:|
| dashboard:read | ✅ | ✅ | ✅ | ✅ | — |
| conversation:read | ✅ | ✅ | ✅ | ✅ | ✅ |
| conversation:reply ¹ | ✅ | ✅ | ✅ | ❌ | ✅ ² |
| conversation:note | ✅ | ✅ | ✅ | ❌ | — |
| conversation:assign_self | ✅ | ✅ | ✅ | ❌ | — |
| conversation:assign_any | ✅ | ✅ | ❌ | ❌ | — |
| conversation:status | ✅ | ✅ | ✅ | ❌ | — |
| conversation:bot_control (pausar/reanudar) | ✅ | ✅ | ✅ | ❌ | ✅ |
| contact:read / contact:write | ✅/✅ | ✅/✅ | ✅/✅ | ✅/❌ | ✅/✅ |
| opportunity:read / opportunity:write | ✅/✅ | ✅/✅ | ✅/✅ | ✅/❌ | ✅/✅ |
| pipeline:configure | ✅ | ✅ | ❌ | ❌ | — |
| task:read / task:write | ✅/✅ | ✅/✅ | ✅/✅ | ✅/❌ | —/✅ |
| bot:read / bot:write / bot:publish | ✅/✅/✅ | ✅/✅/✅ | ✅/❌/❌ | ✅/❌/❌ | — |
| catalog:read / catalog:write (catálogo de productos) | ✅/✅ | ✅/✅ | ✅/❌ | ✅/❌ | ✅/— |
| knowledge:read / knowledge:write | ✅/✅ | ✅/✅ | ✅/❌ | ✅/❌ | ✅/— |
| settings:read / settings:write | ✅/✅ | ✅/❌ | ❌ | ❌ | — |
| members:manage (invitar, roles, deshabilitar) | ✅ | ❌ | ❌ | ❌ | — |
| credentials:manage (Meta, IA) | ✅ | ❌ | ❌ | ❌ | — |
| usage:read | ✅ | ✅ | ❌ | ✅ | — |
| audit:read | ✅ | ❌ | ❌ | ❌ | — |

¹ Un **agent** solo responde si es el responsable o si la conversación no tiene responsable (al responder la toma). manager/admin pueden responder conversaciones de otros (y reasignar).
² El bot solo envía si la conversación sigue en modo `bot` (verificado con bloqueo de fila), la empresa está operativa, hay cupo y la ventana de Meta está abierta.

## platform_admin (Loop Smiths)

- Panel `/admin`: crear empresas, invitar usuarios, planes, suspensión/reactivación, aprovisionar/vincular Chatwoot, reconciliar/reprocesar eventos, ver consumo y estado técnico.
- **Sin acceso a conversaciones, contactos ni secretos** de las empresas: no es miembro del tenant y la API de plataforma no expone esos datos. La impersonación/soporte con acceso temporal está **deshabilitada en V1** (opción "sin acceso" de `context.md` §4.4). Todas sus acciones se auditan (`actor_kind = platform`).

## Reglas transversales

- El tenant activo se toma de una cookie **validada contra las membresías** en cada request; IDs de otra empresa responden 404 (sin revelar existencia).
- Usuario deshabilitado: pierde acceso inmediato y se revocan sus sesiones. No se puede quitar el último administrador.
