# Sicherung zurückspielen (Windows): Doppelklick auf restore.cmd oder
#   powershell -ExecutionPolicy Bypass -File ops\buero\restore.ps1 [-Dir backups\buero\20261004-021500] [-Yes]
# Ohne -Dir werden die vorhandenen Sicherungen zur Auswahl angezeigt.
# ERSETZT Datenbank und Dokumente. Vorher werden die Prüfsummen kontrolliert;
# stimmen sie nicht, passiert nichts. Gleicher Ablauf wie ops/restore.sh, die
# Dateien kommen aber über ein eingebundenes Verzeichnis in die Container.
param([string]$Dir, [switch]$Yes)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ../..))

function Fail($message) {
  Write-Host "X $message" -ForegroundColor Red
  if (-not $Yes) { Read-Host 'Enter zum Schließen' | Out-Null }
  exit 1
}
function Compose {
  docker compose -f docker-compose.buero.yml --env-file .env.buero @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') ist fehlgeschlagen." }
}

if (-not (Test-Path .env.buero)) { Fail '.env.buero fehlt - erst GartenAI einrichten (start.cmd) oder die alte .env.buero zurücklegen.' }

if (-not $Dir) {
  $all = @(Get-ChildItem (Join-Path backups buero) -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^20\d{6}-\d{6}$' } | Sort-Object Name -Descending)
  if (-not $all.Count) { Fail 'Keine Sicherungen in backups\buero gefunden.' }
  Write-Host 'Vorhandene Sicherungen (neueste zuerst):'
  $shown = $all | Select-Object -First 15
  for ($i = 0; $i -lt $shown.Count; $i++) { Write-Host ("  {0,2}  {1}" -f ($i + 1), $shown[$i].Name) }
  $choice = Read-Host 'Nummer der Sicherung (Enter = abbrechen)'
  if (-not $choice) { Fail 'Abgebrochen - nichts geändert.' }
  $index = [int]$choice - 1
  if ($index -lt 0 -or $index -ge $shown.Count) { Fail "Keine Sicherung Nummer $choice." }
  $Dir = $shown[$index].FullName
}

if (-not (Test-Path $Dir)) { Fail "$Dir gibt es nicht." }
$full = (Resolve-Path $Dir).Path
if (-not ((Test-Path (Join-Path $full gartenai.dump)) -and (Test-Path (Join-Path $full SHA256SUMS)))) { Fail "$Dir ist keine Sicherung von GartenAI." }
$mount = "${full}:/restore:ro"

try {
  Compose up -d postgres
  for ($i = 0; $i -lt 30; $i++) {
    docker compose -f docker-compose.buero.yml --env-file .env.buero exec -T postgres pg_isready -U gartenai -d gartenai *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  }

  # Prüfsummen im Container (sha256sum wie beim Sichern)
  docker compose -f docker-compose.buero.yml --env-file .env.buero run --rm --no-deps -T -v $mount --entrypoint sh backup -c 'cd /restore && sha256sum --quiet -c SHA256SUMS'
  if ($LASTEXITCODE -ne 0) { Fail 'Prüfsummen stimmen nicht - Sicherung beschädigt, nichts geändert.' }

  if (-not $Yes) {
    $answer = Read-Host "Aktuelle Datenbank und Dokumente werden durch $(Split-Path $full -Leaf) ersetzt. Fortfahren? (ja/nein)"
    if ($answer -ne 'ja') { Fail 'Abgebrochen - nichts geändert.' }
  }

  Write-Host 'Halte Backend und App an'
  Compose stop backend frontend
  Write-Host 'Spiele die Datenbank zurück'
  Compose run --rm --no-deps -T -v $mount --entrypoint pg_restore backup -h postgres -U gartenai -d gartenai --clean --if-exists --no-owner --exit-on-error /restore/gartenai.dump
  if (Test-Path (Join-Path $full uploads.tgz)) {
    Write-Host 'Spiele die Dokumente zurück'
    Compose run --rm --no-deps -T -v $mount --entrypoint sh backend -c 'find /data/uploads -mindepth 1 -delete && tar xzf /restore/uploads.tgz -C /data/uploads'
  }
  Write-Host 'Starte Backend und App'
  Compose up -d backend frontend
} catch {
  Fail "$_ Backend und App ggf. mit start.cmd wieder starten."
}
Write-Host "Fertig: $(Split-Path $full -Leaf) zurückgespielt." -ForegroundColor Green
if (-not $Yes) { Read-Host 'Enter zum Schließen' | Out-Null }
