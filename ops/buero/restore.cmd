@echo off
rem Sicherung zurueckspielen (Windows): zeigt die Sicherungen zur Auswahl
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore.ps1" %*
