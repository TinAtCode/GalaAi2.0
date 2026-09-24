@echo off
rem Demo zurücksetzen (alle Änderungen weg, frische Beispieldaten) und neu starten.
rem Mit HTTPS: reset.cmd -Https
cd /d "%~dp0..\.."
docker compose -f docker-compose.demo.yml --profile https down -v
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
