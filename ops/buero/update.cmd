@echo off
rem Neue Version einspielen (Windows): sichern, holen, neu starten
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
