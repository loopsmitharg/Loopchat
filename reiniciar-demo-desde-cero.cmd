@echo off
echo Esto BORRA todos los datos de la demo (API keys, bots, conversaciones) y arranca de cero.
choice /M "Continuar"
if errorlevel 2 exit /b
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\detener-demo.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar-demo.ps1" -Reset
