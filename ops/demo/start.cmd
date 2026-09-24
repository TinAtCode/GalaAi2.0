@echo off
rem Demo starten (Windows). Mit HTTPS: start.cmd -Https
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
