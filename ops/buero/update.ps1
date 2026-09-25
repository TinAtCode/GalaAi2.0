# Neue Version einspielen (Windows): Doppelklick auf update.cmd.
# Erst sichern, dann (bei git clone) die neue Version holen und neu starten.
# Die Datenbank wird beim Start des Backends automatisch angepasst.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
Write-Host 'Sichere vor dem Update ...'
docker compose -f docker-compose.buero.yml --env-file .env.buero exec -T backup sh /auto-backup.sh now
if ($LASTEXITCODE -ne 0) {
  Write-Host 'X Sicherung fehlgeschlagen - Update abgebrochen. Läuft GartenAI (start.cmd)?' -ForegroundColor Red
  Read-Host 'Enter zum Schließen' | Out-Null
  exit 1
}
if ((Test-Path .git) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'X git pull fehlgeschlagen (lokale Änderungen?) - nichts geändert.' -ForegroundColor Red
    Read-Host 'Enter zum Schließen' | Out-Null
    exit 1
  }
} else {
  Write-Host 'Kein Git-Ordner: neue Version als ZIP herunterladen und über diesen Ordner entpacken (.env.buero und backups bleiben), dann start.cmd.'
  Read-Host 'Enter, wenn die neue Version entpackt ist' | Out-Null
}
& "$PSScriptRoot\start.ps1"
