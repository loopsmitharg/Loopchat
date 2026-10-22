# Loopchat - arranque local de prueba (Windows / PowerShell 5.1+)
# Levanta Postgres (Docker), instala dependencias, migra, carga datos DEMO,
# arranca los SIMULADORES (Chatwoot/Meta/IA), la app y abre el navegador.
# Solo desarrollo local: nada de esto toca servicios reales.
param([switch]$Reset)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; Read-Host "Enter para cerrar"; exit 1 }
function PortOpen([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); return $true } catch { return $false } finally { $c.Close() }
}
function Run($cmd) {
  Write-Host "   $cmd" -ForegroundColor DarkGray
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Fail "fallo: $cmd" }
}
function NewSecret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return $b
}

# 1. Requisitos
Step "Verificando requisitos"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Falta Node.js 20 o superior: https://nodejs.org (instalar la version LTS y volver a ejecutar)" }
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { Fail "Node.js $(node -v) es viejo. Instalar Node 20+ LTS." }
Write-Host "   Node $(node -v) OK"
$hasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)

# 2. .env local con secretos generados y simuladores
Step "Configurando .env"
if (-not (Test-Path ".env")) {
  $authSecret = [Convert]::ToBase64String((NewSecret 48)).Replace("+", "-").Replace("/", "_").TrimEnd("=")
  $encKey = "k1:" + [Convert]::ToBase64String((NewSecret 32))
  $envText = @"
APP_URL=http://localhost:3000
DATABASE_URL=postgres://loopchat:loopchat@localhost:5432/loopchat_dev
TEST_DATABASE_URL=postgres://loopchat:loopchat@localhost:5432/loopchat_test
DB_POOL_MAX=10
BETTER_AUTH_SECRET=$authSecret
LOOPCHAT_ENCRYPTION_KEYS=$encKey
# SIMULADORES locales (no son Chatwoot/Meta/IA reales)
CHATWOOT_BASE_URL=http://localhost:3011
CHATWOOT_PLATFORM_TOKEN=sim-platform-token
CHATWOOT_WEBHOOK_TARGET_URL=http://localhost:3000
META_GRAPH_BASE_URL=http://localhost:3011/meta-graph/v22.0
SMTP_URL=
MAIL_FROM=Loopchat <no-reply@localhost>
STORAGE_DIR=./storage
LOOPCHAT_INLINE_WORKER=true
LOOPCHAT_ALLOW_PRIVATE_URLS=true
LOOPCHAT_DEMO_MODE=true
AI_REQUEST_TIMEOUT_MS=20000
LOG_LEVEL=info
"@
  [System.IO.File]::WriteAllText((Join-Path $root ".env"), $envText, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "   .env creado (secretos aleatorios, modo simuladores)"
} else {
  Write-Host "   .env ya existe: se usa tal cual (para la demo debe apuntar a los simuladores, ver README)"
}

# 3. Postgres
Step "Levantando PostgreSQL"
if ($hasDocker) {
  cmd /c "docker info >nul 2>nul"
  if ($LASTEXITCODE -ne 0) { Fail "Docker esta instalado pero no esta corriendo. Abri Docker Desktop, espera a que diga 'running' y volve a ejecutar." }
  Run "docker compose -f docker-compose.dev.yml up -d"
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    cmd /c "docker compose -f docker-compose.dev.yml exec -T db pg_isready -U loopchat >nul 2>nul"
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ok) { Fail "PostgreSQL no respondio en 60 s (docker compose -f docker-compose.dev.yml logs db)" }
  Write-Host "   PostgreSQL listo en localhost:5432"
} elseif (PortOpen 5432) {
  Write-Host "   Sin Docker, pero hay un PostgreSQL en 5432: se usa (necesita usuario/clave loopchat/loopchat y base loopchat_dev)" -ForegroundColor Yellow
} else {
  Fail "Hace falta Docker Desktop (https://www.docker.com/products/docker-desktop) o un PostgreSQL 16 local con usuario loopchat/loopchat y base loopchat_dev."
}

# 4. Dependencias
Step "Instalando dependencias (la primera vez tarda unos minutos)"
if (-not (Test-Path "node_modules")) { Run "npm ci" } else { Write-Host "   node_modules ya existe" }

# 5. Simuladores (guardan su estado en storage\, asi sobreviven a reinicios)
foreach ($p in @(3000, 3011, 3012)) { if (PortOpen $p) { Fail "El puerto $p ya esta en uso: Loopchat ya esta corriendo o quedo algo abierto. Ejecuta detener-demo.cmd y volve a intentar." } }
function StartWindow($title, $npmScript) {
  $cmd = "`$Host.UI.RawUI.WindowTitle='Loopchat - $title'; Set-Location -LiteralPath '$root'; npm run $npmScript"
  Start-Process powershell -ArgumentList @("-NoExit", "-NoProfile", "-Command", $cmd) | Out-Null
}
$simState = Join-Path $root "storage\chatwoot-sim-state.json"
if ($Reset -and (Test-Path $simState)) { Remove-Item $simState -Force }
Step "Arrancando simuladores (se abren ventanas; no las cierres mientras pruebas)"
StartWindow "Simulador Chatwoot" "sim:chatwoot:demo"
StartWindow "Simulador IA" "sim:ai"
$simUp = $false
for ($i = 0; $i -lt 90; $i++) { if (PortOpen 3011) { $simUp = $true; break }; Start-Sleep -Seconds 1 }
if (-not $simUp) { Fail "El simulador de Chatwoot no arranco. Mira la ventana 'Loopchat - Simulador Chatwoot'." }

# 6. Base de datos: se conserva si coincide con el simulador; si no, se recrea
Step "Revisando datos de la demo"
$fresh = [bool]$Reset
if (-not $fresh) {
  cmd /c "npm run -s demo:check"
  if ($LASTEXITCODE -ne 0) { $fresh = $true }
}
if ($fresh) {
  Step "Preparando base DEMO desde cero"
  Run "npm run demo:reset"
}
Run "npm run db:migrate"
Run "npm run db:seed:plans"
Run "npm run db:seed:demo"

Step "Arrancando la app"
StartWindow "App" "dev"
Step "Esperando que la app responda en http://localhost:3000"
$ready = $false
for ($i = 0; $i -lt 180; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:3000/api/health"; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch { }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Fail "La app no respondio en 3 minutos. Mira la ventana 'Loopchat - App' para ver el error." }
# precompila la pantalla de login para que la primera carga no sea lenta
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 "http://localhost:3000/login" | Out-Null } catch { }

# 7. Conectar empresas DEMO a los simuladores y generar conversaciones
if ($fresh) {
  Step "Conectando empresas DEMO a los simuladores"
  Run "npm run db:seed:demo-sim"
} else {
  # agrega datos DEMO nuevos (catalogo, datos comerciales) sin tocar lo que ya configuraste
  Run "npm run db:seed:demo-catalog"
}

Start-Process "http://localhost:3000/login"
Write-Host ""
Write-Host "Listo. Loopchat corre en http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Contrasena de todos los usuarios DEMO: demo-loopchat-123"
Write-Host "  admin@ferreteria.demo.loopchat.test    administrador empresa A"
Write-Host "  manager@ferreteria.demo.loopchat.test  gerente empresa A"
Write-Host "  agente@ferreteria.demo.loopchat.test   agente empresa A"
Write-Host "  lectura@ferreteria.demo.loopchat.test  solo lectura empresa A"
Write-Host "  admin@optica.demo.loopchat.test        administrador empresa B"
Write-Host "  plataforma@demo.loopchat.test          panel Loop Smiths (/admin)"
Write-Host ""
Write-Host "Simular un WhatsApp entrante: mensaje-demo.cmd ""Hola, precio del taladro?"""
Write-Host "Para apagar todo: detener-demo.cmd"
Write-Host "Tus datos (API keys, bots, conversaciones) se conservan entre reinicios. Para borrar todo: reiniciar-demo-desde-cero.cmd" -ForegroundColor Yellow
Write-Host ""
Read-Host "Enter para cerrar esta ventana (la app sigue corriendo en las otras)"
