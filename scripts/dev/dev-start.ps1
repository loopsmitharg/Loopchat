# Inicia (idempotente) Loopchat + Chatwoot CE real + Cloudflare Quick Tunnels.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\dev\dev-start.ps1 [-Build]
param([switch]$Build)
. (Join-Path $PSScriptRoot '_lib.ps1')

Write-Host '1) Docker'
docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  $dd = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
  if (-not (Test-Path $dd)) { $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe' }
  Start-Process $dd
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 5; docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break } }
  if ($LASTEXITCODE -ne 0) { throw 'Docker no respondio en 5 minutos' }
}
Write-Host '   ok'

Write-Host '2) PostgreSQL de Loopchat y Chatwoot (Rails, Sidekiq, PostgreSQL, Redis)'
& docker compose -f (Join-Path $Root 'docker-compose.dev.yml') up -d | Out-Null
Invoke-Chatwoot @('up', '-d') | Out-Null
for ($i = 0; $i -lt 40 -and (Test-Http 'http://localhost:3001/api') -ne 200; $i++) { Start-Sleep 5 }
if ((Test-Http 'http://localhost:3001/api') -ne 200) { throw 'Chatwoot no responde en http://localhost:3001/api' }
Write-Host '   ok'

Write-Host '3) Cloudflare Quick Tunnels (URLs temporales)'
$cf = Get-Cloudflared
foreach ($t in @(@{ n = 'loopchat'; p = 3000 }, @{ n = 'chatwoot'; p = 3001 })) {
  $pidFile = Join-Path $Tun "$($t.n).pid"
  if (-not (Get-Tracked $pidFile @('cloudflared'))) {
    $log = Join-Path $Tun "$($t.n).log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://localhost:$($t.p)", '--logfile', $log) -WindowStyle Hidden -PassThru
    Set-Content $pidFile $p.Id
    for ($i = 0; $i -lt 30 -and -not (Get-TunnelUrl $t.n); $i++) { Start-Sleep 1 }
  }
}
$lcUrl = Get-TunnelUrl 'loopchat'; $cwUrl = Get-TunnelUrl 'chatwoot'
if (-not $lcUrl -or -not $cwUrl) { throw 'No se obtuvo la URL de algun tunel (ver storage\tunnels\*.log)' }
Write-Host "   Loopchat: $lcUrl"
Write-Host "   Chatwoot: $cwUrl"

Write-Host '4) URLs publicas en la configuracion'
$envFile = Join-Path $Root '.env'; $cwEnv = Join-Path $CwDir '.env'
$appChanged = (Get-EnvLine $envFile 'APP_URL') -ne $lcUrl
if ($appChanged) { Set-EnvLine $envFile 'APP_URL' $lcUrl; Write-Host '   APP_URL actualizado' }
if ((Get-EnvLine $cwEnv 'FRONTEND_URL') -ne $cwUrl) {
  Set-EnvLine $cwEnv 'FRONTEND_URL' $cwUrl
  Invoke-Chatwoot @('up', '-d', '--force-recreate', 'rails', 'sidekiq') | Out-Null
  for ($i = 0; $i -lt 40 -and (Test-Http 'http://localhost:3001/api') -ne 200; $i++) { Start-Sleep 5 }
  Write-Host '   FRONTEND_URL de Chatwoot actualizado'
}
# Webhooks de Chatwoot hacia Loopchat: mismo secreto, nuevo host publico (el filtro SSRF de Chatwoot sigue activo)
$rb = "n=0; Webhook.where('url LIKE ?', '%/api/webhooks/chatwoot/%').find_each { |w| u = w.url.sub(%r{\Ahttps?://[^/]+}, ENV['LC_URL']); (w.update!(url: u); n += 1) if u != w.url }; puts %(webhooks_actualizados=#{n})"
$res = docker exec -e RAILS_ENV=production -e "LC_URL=$lcUrl" chatwoot-rails-1 bundle exec rails runner $rb 2>$null | Select-String 'webhooks_actualizados'
Write-Host "   $res"

Write-Host '5) Base de Loopchat (migraciones pendientes)'
Push-Location $Root
try {
  & npm run db:migrate --silent | Out-Null
  if ($Build -or -not (Test-Path (Join-Path $Root '.next\BUILD_ID'))) {
    Write-Host '   compilando (next build)...'
    $env:NODE_ENV = 'production'; & npm run build --silent | Out-Null
    # Next 16.4.2 corta el primer build con un aviso de seguridad: se reintenta una vez (ver 07_TROUBLESHOOTING.md)
    if ($LASTEXITCODE -ne 0) { & npm run build --silent | Out-Null }
    if ($LASTEXITCODE -ne 0) { throw 'next build fallo (ver salida de npm run build)' }
  }
} finally { Pop-Location }

Write-Host '6) Web y worker de Loopchat'
$env:NODE_ENV = 'production'
$webPid = Join-Path $Run 'web.pid'; $wkPid = Join-Path $Run 'worker.pid'
if ($appChanged) { Stop-Tracked $webPid @('cmd') 'web (APP_URL cambio)' }
if (-not (Get-Tracked $webPid @('cmd'))) {
  # la redireccion la hace cmd: Start-Process -Redirect* hereda los handles de esta consola
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx next start -p 3000 -H 127.0.0.1 > storage\run\web.log 2> storage\run\web.err.log' -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content $webPid $p.Id
}
if (-not (Get-Tracked $wkPid @('cmd'))) {
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run worker > storage\run\worker.log 2> storage\run\worker.err.log' -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content $wkPid $p.Id
}
for ($i = 0; $i -lt 30 -and (Test-Http 'http://127.0.0.1:3000/api/health') -ne 200; $i++) { Start-Sleep 2 }

& (Join-Path $PSScriptRoot 'dev-status.ps1')
