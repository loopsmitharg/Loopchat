# 07 — Problemas encontrados y soluciones

| Síntoma | Causa | Solución aplicada |
|---|---|---|
| `docker info`: `open //./pipe/dockerDesktopLinuxEngine` | Docker Desktop apagado; instalado por usuario en `%LOCALAPPDATA%\Programs\DockerDesktop` | `dev-start.ps1` lo inicia y espera al daemon |
| `winget install Cloudflare.cloudflared` no termina | El instalador MSI espera confirmación (UAC) | Binario oficial firmado en `%LOCALAPPDATA%\cloudflared\` (sin admin) |
| `rails runner` no encuentra `/tmp/...` | Git Bash convierte rutas POSIX | `MSYS_NO_PATHCONV=1` o ejecutar desde PowerShell |
| Chatwoot redirige a `/installation/onboarding` | Instalación nueva sin el asistente completado (el super admin se creó por consola) | Se borró la marca `CHATWOOT_INSTALLATION_ONBOARDING` de Redis |
| `Configuración inválida: CHATWOOT_WEBHOOK_TARGET_URL` | Variable presente pero vacía (falla `url()`) | Eliminar la línea: sin la variable se usa `APP_URL` |
| `next build`: `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability` | Next.js 16.4.2 tiene un aviso de seguridad publicado; el build se corta una vez para mostrarlo | Reintentar compila bien (`dev-start` reintenta una vez). **Pendiente: actualizar Next.js** (hay 16.4.x más nuevas; decisión del equipo, ver `08_NEXT_STEPS.md`) |
| Webhooks de Chatwoot dejan de llegar tras reiniciar | Quick Tunnel nuevo = host nuevo | `dev-start` reescribe el host de los webhooks en Chatwoot (mismo secreto) |
| Dos mensajes al cliente cuando falla la IA (aviso de falla + aviso de derivación) | `onFailure: message_and_handoff` sumado al mensaje fijo de derivación | Bots de Todo Trabajo con `onFailure: handoff` (queda un solo mensaje) |
| `dev-start.ps1` no "termina" cuando se ejecuta desde otra herramienta | `Start-Process -RedirectStandardOutput` hereda los handles de la consola | La redirección la hace `cmd /c ... > log` |
| Equipo: "Hay dos derivaciones iguales entre los mismos nodos" | Se intentó una derivación por palabras clave y otra por intención al mismo destino | Una sola derivación por par (palabras clave) |
| Palabras de derivación de un bot disparan con "recursos humanos" | El runtime compara `handoffKeywords` por **subcadena** | Frases completas ("hablar con una persona", "un operador"); las derivaciones del equipo sí comparan por palabras |
| Simulador: el Asesor de Empresas "deriva" con "contratar personal" | La IA **simulada** deriva si el texto contiene "persona" (incluso dentro de "personal") | Artefacto del simulador, no del bot; anotado en la evidencia |

## Comandos útiles

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-status.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\dev-logs.ps1 worker -Lines 80
```

```powershell
docker compose -p chatwoot --project-directory infra\chatwoot ps
```
