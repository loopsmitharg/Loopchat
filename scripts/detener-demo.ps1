# Loopchat - apaga la demo local (ventanas de la app/simuladores y PostgreSQL de Docker)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "Cerrando app y simuladores..."
Get-Process powershell, pwsh -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "Loopchat - *" } | ForEach-Object { cmd /c "taskkill /T /F /PID $($_.Id) >nul 2>nul" }
foreach ($port in 3000, 3011, 3012) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { cmd /c "taskkill /T /F /PID $($_.OwningProcess) >nul 2>nul" }
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Host "Deteniendo PostgreSQL (los datos quedan en el volumen de Docker)..."
  cmd /c "docker compose -f docker-compose.dev.yml stop"
}
Write-Host "Listo." -ForegroundColor Green
Start-Sleep -Seconds 2
