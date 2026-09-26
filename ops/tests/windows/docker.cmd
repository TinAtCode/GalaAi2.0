@echo off
rem Attrappe fuer docker (nur fuer ops\tests\windows-buero.test.ps1)
node "%~dp0mock-docker.js" %*
