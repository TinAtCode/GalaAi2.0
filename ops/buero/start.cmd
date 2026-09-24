@echo off
rem GartenAI im Buero starten (Windows). Mit Demo-Daten: start.cmd -DemoDaten
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
