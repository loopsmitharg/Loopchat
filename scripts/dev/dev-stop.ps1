# Detiene el entorno local SIN borrar datos (no usa "down -v": los volumenes quedan intactos).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\dev\dev-stop.ps1 [-KeepDocker]
param([switch]$KeepDocker)
. (Join-Path $PSScriptRoot '_lib.ps1')
Write-Host 'Loopchat'
Stop-Tracked (Join-Path $Run 'worker.pid') @('cmd') 'worker'
Stop-Tracked (Join-Path $Run 'web.pid') @('cmd') 'web'
Write-Host 'Tuneles'
foreach ($n in 'loopchat', 'chatwoot') { Stop-Tracked (Join-Path $Tun "$n.pid") @('cloudflared') "tunel $n" }
if (-not $KeepDocker) {
  Write-Host 'Contenedores (stop, datos conservados)'
  Invoke-Chatwoot @('stop') | Out-Null
  & docker compose -f (Join-Path $Root 'docker-compose.dev.yml') stop | Out-Null
  Write-Host '  Chatwoot y PostgreSQL de Loopchat detenidos'
}
