@echo off
rem GartenAI im Buero pruefen. Support-Paket fuer die IT: status.cmd -Support
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1" %*
