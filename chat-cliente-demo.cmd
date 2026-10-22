@echo off
title Loopchat - Chat como cliente DEMO
cd /d "%~dp0"
call npm run -s demo:chat -- %*
pause
