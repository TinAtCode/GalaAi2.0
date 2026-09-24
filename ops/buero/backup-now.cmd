@echo off
rem Sofort sichern (zusaetzlich zur taeglichen Sicherung)
cd /d "%~dp0..\.."
docker compose -f docker-compose.buero.yml --env-file .env.buero exec -T backup sh /auto-backup.sh now
pause
