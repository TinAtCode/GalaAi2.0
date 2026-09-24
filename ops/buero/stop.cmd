@echo off
rem GartenAI im Buero beenden (Daten bleiben erhalten)
cd /d "%~dp0..\.."
docker compose -f docker-compose.buero.yml --env-file .env.buero --profile demo stop
pause
