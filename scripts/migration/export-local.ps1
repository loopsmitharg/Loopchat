# Exporta el entorno local (Loopchat + Chatwoot) para migrarlo al VPS. Es el CORTE: deja la PC sin responder.
#   powershell -ExecutionPolicy Bypass -File scripts\migration\export-local.ps1
# Hace: detiene web, worker, tuneles y Chatwoot (rails/sidekiq); deja solo las bases arriba; vuelca ambas bases,
# los archivos de Chatwoot y de Loopchat; guarda conteos de integridad y SHA256SUMS; marca la PC como migrada
# (dev-start.ps1 se niega a arrancar mientras exista storage\run\MIGRATED_TO_VPS).
# NO copia secretos: el paquete no sirve sin LOOPCHAT_ENCRYPTION_KEYS y las claves de Chatwoot (ver docs/migracion-vps.md).
# Solo ASCII en este archivo: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
param([string]$OutDir)
. (Join-Path $PSScriptRoot '..\dev\_lib.ps1')

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
if (-not $OutDir) { $OutDir = Join-Path $Root "storage\migration\$stamp" }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$devCompose = Join-Path $Root 'docker-compose.dev.yml'
function Assert-Ok([string]$what) { if ($LASTEXITCODE -ne 0) { throw "fallo: $what" } }

Write-Host '1) Corte: detener todo lo que responde mensajes'
& (Join-Path $PSScriptRoot '..\dev\dev-stop.ps1') -KeepDocker
Invoke-Chatwoot @('stop', 'rails', 'sidekiq') | Out-Null; Assert-Ok 'detener Chatwoot'
Set-Content -Path (Join-Path $Run 'MIGRATED_TO_VPS') -Value "Exportado $stamp a $OutDir. Borrar este archivo solo para un rollback (docs/migracion-vps.md)." -Encoding ASCII
Write-Host '   PC marcada como migrada (storage\run\MIGRATED_TO_VPS)'

Write-Host '2) Bases arriba (solo PostgreSQL)'
& docker compose -f $devCompose up -d db | Out-Null; Assert-Ok 'PostgreSQL de Loopchat'
Invoke-Chatwoot @('up', '-d', 'postgres') | Out-Null; Assert-Ok 'PostgreSQL de Chatwoot'
for ($i = 0; $i -lt 30; $i++) {
  & docker compose -f $devCompose exec -T db pg_isready -U loopchat -d loopchat_dev *> $null; $a = $LASTEXITCODE
  Invoke-Chatwoot @('exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'chatwoot') *> $null; $b = $LASTEXITCODE
  if ($a -eq 0 -and $b -eq 0) { break }; Start-Sleep 2
}

Write-Host '3) Volcados (pg_dump dentro del contenedor + docker cp: sin pasar binarios por la consola)'
$lcId = (& docker compose -f $devCompose ps -q db).Trim()
& docker exec $lcId pg_dump -U loopchat -Fc -f /tmp/loopchat.dump loopchat_dev; Assert-Ok 'pg_dump Loopchat'
& docker cp "${lcId}:/tmp/loopchat.dump" (Join-Path $OutDir 'loopchat.dump'); Assert-Ok 'copiar dump Loopchat'
& docker exec $lcId rm -f /tmp/loopchat.dump
$cwId = (Invoke-Chatwoot @('ps', '-q', 'postgres')).Trim()
& docker exec $cwId pg_dump -U postgres -Fc -f /tmp/chatwoot.dump chatwoot; Assert-Ok 'pg_dump Chatwoot'
& docker cp "${cwId}:/tmp/chatwoot.dump" (Join-Path $OutDir 'chatwoot.dump'); Assert-Ok 'copiar dump Chatwoot'
& docker exec $cwId rm -f /tmp/chatwoot.dump

Write-Host '4) Archivos'
& docker run --rm -v chatwoot_storage_data:/v:ro -v "${OutDir}:/out" alpine:3 tar czf /out/chatwoot-storage.tgz -C /v .; Assert-Ok 'archivos de Chatwoot'
$lcStorage = Join-Path $Root 'storage'
$dirs = @('knowledge', 'products') | Where-Object { Test-Path (Join-Path $lcStorage $_) }
if ($dirs) { & tar.exe -czf (Join-Path $OutDir 'loopchat-storage.tgz') -C $lcStorage @dirs; Assert-Ok 'archivos de Loopchat' }
else { & tar.exe -czf (Join-Path $OutDir 'loopchat-storage.tgz') -T NUL; Assert-Ok 'archivos de Loopchat (vacio)' }
Write-Host "   Loopchat: $(if ($dirs) { $dirs -join ', ' } else { 'sin archivos subidos' })"

Write-Host '5) Conteos de integridad y metadatos'
Get-Content (Join-Path $PSScriptRoot 'loopchat-counts.sql') -Raw | & docker exec -i $lcId psql -U loopchat -d loopchat_dev -At -F '=' | Set-Content (Join-Path $OutDir 'loopchat-counts.txt') -Encoding ASCII
Get-Content (Join-Path $PSScriptRoot 'chatwoot-counts.sql') -Raw | & docker exec -i $cwId psql -U postgres -d chatwoot -At -F '=' | Set-Content (Join-Path $OutDir 'chatwoot-counts.txt') -Encoding ASCII
$meta = @(
  "exported_at=$stamp",
  "git_commit=$((& git -C $Root rev-parse HEAD).Trim())",
  "chatwoot_version=$(Get-EnvLine (Join-Path $CwDir '.env') 'CHATWOOT_VERSION')",
  "loopchat_migrations=$((& docker exec $lcId psql -U loopchat -d loopchat_dev -At -c 'select count(*) from drizzle.__drizzle_migrations').Trim())"
)
[IO.File]::WriteAllText((Join-Path $OutDir 'meta.txt'), (($meta -join "`n") + "`n"))

# formato de sha256sum -c (hash, dos espacios, nombre; saltos LF) para verificar en Linux
$sums = Get-ChildItem $OutDir -File | Where-Object { $_.Name -ne 'SHA256SUMS' } | Sort-Object Name | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" }
[IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS'), (($sums -join "`n") + "`n"))

Write-Host ''
Write-Host "Paquete listo: $OutDir"
Get-Content (Join-Path $OutDir 'meta.txt') | ForEach-Object { Write-Host "   $_" }
Write-Host ''
Write-Host 'Secretos (NO estan en el paquete; pasarlos por el gestor de secretos, nunca por chat/mail):'
Write-Host '   .env local          -> BETTER_AUTH_SECRET, LOOPCHAT_ENCRYPTION_KEYS, CHATWOOT_PLATFORM_TOKEN'
Write-Host '   infra\chatwoot\.env -> SECRET_KEY_BASE, ACTIVE_RECORD_ENCRYPTION_* (3), REDIS_PASSWORD, POSTGRES_PASSWORD'
Write-Host 'Siguiente: copiar la carpeta al VPS (scp -r) y correr scripts/migration/import-vps.sh <carpeta>.'
