@echo off
rem Demo beenden (die Daten bleiben)
cd /d "%~dp0..\.."
docker compose -f docker-compose.demo.yml --profile https down
pause
