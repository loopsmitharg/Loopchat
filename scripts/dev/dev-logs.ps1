# Ultimas lineas de logs. Uso: scripts\dev\dev-logs.ps1 [web|worker|chatwoot|sidekiq|tunnels] [-Lines 60]
param([ValidateSet('web', 'worker', 'chatwoot', 'sidekiq', 'tunnels', 'all')][string]$What = 'all', [int]$Lines = 40)
. (Join-Path $PSScriptRoot '_lib.ps1')
function Tail($title, $file) { "== $title"; if (Test-Path $file) { Get-Content $file -Tail $Lines } else { '(sin log)' } }
if ($What -in 'web', 'all') { Tail 'web' (Join-Path $Run 'web.log'); Tail 'web (errores)' (Join-Path $Run 'web.err.log') }
if ($What -in 'worker', 'all') { Tail 'worker' (Join-Path $Run 'worker.log'); Tail 'worker (errores)' (Join-Path $Run 'worker.err.log') }
if ($What -in 'chatwoot', 'all') { '== chatwoot rails'; docker logs --tail $Lines chatwoot-rails-1 2>&1 }
if ($What -in 'sidekiq', 'all') { '== chatwoot sidekiq'; docker logs --tail $Lines chatwoot-sidekiq-1 2>&1 }
if ($What -in 'tunnels', 'all') { foreach ($n in 'loopchat', 'chatwoot') { Tail "tunel $n" (Join-Path $Tun "$n.log") } }
