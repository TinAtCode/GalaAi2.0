# GartenAI im Büro prüfen (Windows): Doppelklick auf status.cmd oder
#   powershell -ExecutionPolicy Bypass -File ops\buero\status.ps1 [-Support]
# Zeigt, ob alle Dienste laufen, HTTPS antwortet, die letzte Sicherung aktuell
# und unversehrt ist, genug Speicher frei ist und wann das Zertifikat abläuft.
# -Support: zusätzlich ein Support-Paket für die IT (backups\support-….zip):
#   diese Übersicht, Container-Status und die letzten Log-Zeilen – ohne
#   Passwörter und Schlüssel aus .env.buero
# Ergebnis 0 = alles in Ordnung, 1 = mindestens ein Problem.
param([switch]$Support, [switch]$NoPause)
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$envFile = '.env.buero'
$lines = New-Object System.Collections.Generic.List[string]
function Ok($m) { $lines.Add("OK $m"); Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { $lines.Add("!  $m"); Write-Host "!  $m" -ForegroundColor Yellow }
function Bad($m) { $lines.Add("X  $m"); Write-Host "X  $m" -ForegroundColor Red }

function Test-Installation {
  if (-not (Test-Path $envFile)) { Bad "Noch nicht eingerichtet ($envFile fehlt) - zuerst start.cmd"; return }
  $settings = @{}
  Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $settings[$k] = $v }
  $port = if ($settings['HTTPS_PORT']) { $settings['HTTPS_PORT'] } else { '8443' }
  $compose = @('compose', '-f', 'docker-compose.buero.yml', '--env-file', $envFile)

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Bad 'Docker fehlt - bitte Docker Desktop installieren.'; return }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Bad 'Docker läuft nicht - bitte Docker Desktop starten, dann start.cmd.'; return }

  # Dienste: laufen sie, und melden sie sich gesund (falls sie das prüfen)?
  foreach ($svc in 'postgres', 'backend', 'frontend', 'https', 'backup') {
    $state = (docker @compose ps -a --format '{{.State}} {{.Health}}' $svc 2>$null | Select-Object -First 1)
    $state = if ($state) { "$state".Trim() } else { '' }
    if ($state -eq 'running healthy' -or $state -eq 'running') { Ok "Dienst $svc läuft" }
    elseif ($state -eq 'running starting') { Warn "Dienst $svc startet noch" }
    elseif (-not $state) { Bad "Dienst $svc ist nicht gestartet - start.cmd" }
    else { Bad "Dienst ${svc}: $state - Logs: docker compose -f docker-compose.buero.yml logs $svc" }
  }

  # HTTPS wie im Browser: Windows vertraut der eigenen Zertifizierungsstelle (start.cmd trägt sie ein)
  try {
    $health = Invoke-RestMethod "https://localhost:$port/api/health" -TimeoutSec 15
    $version = if ($health.version) { " (Version $($health.version))" } else { '' }
    Ok "GartenAI antwortet unter https://localhost:$port$version"
  } catch { Bad "GartenAI antwortet nicht unter https://localhost:$port ($($_.Exception.Message))" }

  # Zertifikat: Alter der Datei (gilt 825 Tage, start.cmd erneuert nach 760)
  if (Test-Path 'ops\buero\certs\server.crt') {
    $age = ((Get-Date) - (Get-Item 'ops\buero\certs\server.crt').LastWriteTime).TotalDays
    if ($age -gt 820) { Bad 'Zertifikat abgelaufen oder kurz davor - start.cmd erneuert es' }
    elseif ($age -gt 760) { Warn 'Zertifikat läuft bald ab - beim nächsten start.cmd wird es erneuert' }
    else { Ok 'Zertifikat gültig' }
  } else { Bad 'Zertifikat fehlt - start.cmd' }

  # Sicherungen: jüngste nicht älter als 36 Stunden, Prüfsummen stimmen
  $backups = @(Get-ChildItem 'backups\buero' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^20\d+-\d+$' } | Sort-Object Name)
  if (-not $backups) { Bad 'Noch keine Sicherung - backup-now.cmd' }
  else {
    $newest = $backups[-1]
    $size = '{0:N1} MB' -f ((Get-ChildItem $newest.FullName -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
    if ($newest.LastWriteTime -lt (Get-Date).AddHours(-36)) {
      Bad "Letzte Sicherung $($newest.Name) ist älter als 36 Stunden - läuft der Dienst backup?"
    } else { Ok "Letzte Sicherung $($newest.Name) ($size, $($backups.Count) Sicherungen vorhanden)" }
    $sums = Join-Path $newest.FullName 'SHA256SUMS'
    if (-not (Test-Path $sums)) { Bad 'Letzte Sicherung ohne Prüfsummen (unvollständig?)' }
    else {
      $broken = $false
      foreach ($line in Get-Content $sums) {
        if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
        $expected = $Matches[1]
        $file = Join-Path $newest.FullName ($Matches[2].Trim() -replace '^\./', '')
        if (-not (Test-Path $file) -or (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -ne $expected) { $broken = $true }
      }
      if ($broken) { Bad 'Letzte Sicherung beschädigt (Prüfsummen stimmen nicht) - sofort neu sichern' }
      else { Ok 'Letzte Sicherung unversehrt (Prüfsummen stimmen)' }
    }
    $backupLog = docker @compose logs --no-color --since 48h backup 2>$null
    if ("$backupLog" -match 'FEHLER') { Bad 'Die automatische Sicherung meldet Fehler - docker compose -f docker-compose.buero.yml logs backup' }
  }

  # Speicherplatz auf dem Laufwerk mit den Sicherungen
  $drive = (Get-Item (Resolve-Path '.')).PSDrive
  if ($drive -and $drive.Free) {
    $freeGb = [math]::Floor($drive.Free / 1GB)
    if ($freeGb -lt 2) { Bad "Nur noch $freeGb GB frei - Speicher freigeben oder BACKUP_KEEP senken" }
    elseif ($freeGb -lt 10) { Warn "Nur noch $freeGb GB frei" }
    else { Ok "$freeGb GB frei" }
  }
}

Test-Installation
$problems = @($lines | Where-Object { $_ -like 'X *' }).Count
Write-Host ''
if ($problems -eq 0) { Write-Host 'Alles in Ordnung.' -ForegroundColor Green } else { Write-Host "$problems Problem(e) gefunden." -ForegroundColor Red }

if ($Support) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dir = "backups\support-$stamp"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $compose = @('compose', '-f', 'docker-compose.buero.yml', '--env-file', $envFile)
  @("GartenAI Support-Paket $stamp", "System: $([Environment]::OSVersion.VersionString)", '') + $lines |
    Set-Content -Encoding utf8 "$dir\status.txt"
  docker version *> "$dir\docker-version.txt"
  docker @compose ps -a *> "$dir\container.txt"
  foreach ($svc in 'postgres', 'backend', 'frontend', 'https', 'backup', 'cloud-backup', 'tunnel') {
    docker @compose logs --no-color --tail=500 $svc *> "$dir\log-$svc.txt"
  }
  # Einstellungen ohne Werte: nur, welche gesetzt sind (keine Passwörter oder Schlüssel)
  if (Test-Path $envFile) {
    $keys = foreach ($line in Get-Content $envFile) {
      if ($line -match '^([A-Z_]+)=(.*)$') { if ($Matches[2]) { "$($Matches[1]) gesetzt" } else { "$($Matches[1]) leer" } }
    }
    $keys | Set-Content -Encoding utf8 "$dir\einstellungen.txt"
  }
  Compress-Archive -Path "$dir\*" -DestinationPath "$dir.zip" -Force
  Remove-Item -Recurse -Force $dir
  Write-Host ''
  Write-Host "Support-Paket: $dir.zip"
  Write-Host 'Es enthält keine Passwörter oder Schlüssel. Die Protokolle können Namen und'
  Write-Host 'E-Mail-Adressen von Nutzern enthalten - nur an die zuständige IT weitergeben.'
}

if (-not $NoPause) { Read-Host 'Enter zum Schließen' | Out-Null }
exit [int]($problems -gt 0)
