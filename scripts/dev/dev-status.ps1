# Estado del entorno local (no muestra secretos).
. (Join-Path $PSScriptRoot '_lib.ps1')
function Row($name, $ok, $where) { '{0,-28} {1,-8} {2}' -f $name, $(if ($ok) { 'OK' } else { 'ERROR' }), $where }
$lc = Get-TunnelUrl 'loopchat'; $cw = Get-TunnelUrl 'chatwoot'
$ps = @(docker ps --format '{{.Names}}|{{.Status}}' 2>$null)
function Up($n) { [bool]($ps | Where-Object { $_ -like "$n|Up*" }) }
$health = try { Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 8 } catch { $null }
$cwApi = try { Invoke-RestMethod 'http://localhost:3001/api' -TimeoutSec 8 } catch { $null }
$redisOk = (docker exec chatwoot-redis-1 sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping' 2>$null) -eq 'PONG'
$sidekiqOk = (Up 'chatwoot-sidekiq-1') -and [bool](docker logs --since 24h chatwoot-sidekiq-1 2>&1 | Select-String -SimpleMatch 'Booted Rails' -Quiet)
''
'{0,-28} {1,-8} {2}' -f 'Servicio', 'Estado', 'Direccion'
Row 'Loopchat web' ($health.status -eq 'ok') 'http://127.0.0.1:3000'
Row 'Loopchat worker' ([bool](Get-Tracked (Join-Path $Run 'worker.pid') @('cmd'))) 'proceso local'
Row 'PostgreSQL Loopchat' ((Up 'loopchat-db-1') -and $health.database -eq 'ok') 'localhost:5432 (solo local)'
Row 'Chatwoot (Rails)' ($cwApi.version -ne $null) ("http://localhost:3001  v" + $cwApi.version)
Row 'Chatwoot Sidekiq' $sidekiqOk ("queue_services=" + $cwApi.queue_services)
Row 'PostgreSQL Chatwoot' ((Up 'chatwoot-postgres-1') -and $cwApi.data_services -eq 'ok') 'red interna de Docker'
Row 'Redis Chatwoot' $redisOk 'red interna de Docker'
Row 'Tunel Loopchat' ($lc -and (Test-Http "$lc/api/health") -eq 200) $lc
Row 'Tunel Chatwoot' ($cw -and (Test-Http "$cw/api") -eq 200) $cw
''
if ($cw) { "Webhook de Meta para Chatwoot: $cw/webhooks/whatsapp/<numero con codigo de pais>" }
'Las URLs trycloudflare.com cambian cada vez que se reinician los tuneles.'
