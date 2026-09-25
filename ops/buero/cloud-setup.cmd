@echo off
rem Cloud-Sicherung einrichten (Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloud-setup.ps1" %*
