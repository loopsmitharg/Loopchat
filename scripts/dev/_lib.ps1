# Funciones compartidas del entorno local (Loopchat + Chatwoot real + Cloudflare Quick Tunnels).
# Solo ASCII en este archivo: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Run = Join-Path $Root 'storage\run'
$Tun = Join-Path $Root 'storage\tunnels'
$CwDir = Join-Path $Root 'infra\chatwoot'
New-Item -ItemType Directory -Force $Run, $Tun | Out-Null

function Get-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
  if (Test-Path $p) { return $p }
  throw 'cloudflared no encontrado (ver docs/local-whatsapp-setup/03_CLOUDFLARE_TUNNELS.md)'
}

# Proceso vivo registrado por estos scripts (verifica nombre para no tocar procesos ajenos con el mismo PID)
function Get-Tracked([string]$pidFile, [string[]]$names) {
  if (-not (Test-Path $pidFile)) { return $null }
  $id = [int](Get-Content $pidFile -TotalCount 1)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and ($names -contains $p.ProcessName)) { return $p }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return $null
}

function Stop-Tracked([string]$pidFile, [string[]]$names, [string]$label) {
  $p = Get-Tracked $pidFile $names
  if ($p) {
    & taskkill.exe /T /F /PID $p.Id | Out-Null  # arbol propio (cmd -> node)
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Write-Host "  detenido: $label"
  } else { Write-Host "  no estaba corriendo: $label" }
}

function Get-TunnelUrl([string]$name) {
  $log = Join-Path $Tun "$name.log"
  if (-not (Test-Path $log)) { return $null }
  $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Value } else { return $null }
}

function Test-Http([string]$url) {
  try { return (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8).StatusCode } catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

function Set-EnvLine([string]$file, [string]$key, [string]$value) {
  $lines = @(Get-Content $file -Encoding UTF8)
  $found = $false
  $out = foreach ($l in $lines) { if ($l -match "^$key=") { $found = $true; "$key=$value" } else { $l } }
  if (-not $found) { $out += "$key=$value" }
  [IO.File]::WriteAllLines($file, [string[]]$out, (New-Object Text.UTF8Encoding $false))
}

function Get-EnvLine([string]$file, [string]$key) {
  $m = Select-String -Path $file -Pattern "^$key=(.*)$" | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value } else { return $null }
}

function Invoke-Chatwoot([string[]]$composeArgs) {
  & docker compose -p chatwoot --project-directory $CwDir -f (Join-Path $CwDir 'docker-compose.yml') @composeArgs
}
