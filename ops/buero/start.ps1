# GartenAI im Büro starten (Windows): Doppelklick auf start.cmd oder
#   powershell -ExecutionPolicy Bypass -File ops\buero\start.ps1 [-DemoDaten]
# -DemoDaten: Musterbetrieb und Demo-Agent zum Ausprobieren laden.
# Beim ersten Start: Geheimnisse in .env.buero, eigene Zertifizierungsstelle,
# Ersteinrichtung im Browser mit dem angezeigten Einrichtungscode.
param([switch]$DemoDaten)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$envFile = '.env.buero'

function Fail($message) { Write-Host "X $message" -ForegroundColor Red; Read-Host 'Enter zum Schließen'; exit 1 }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker fehlt - bitte Docker Desktop installieren und starten.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker läuft nicht - bitte Docker Desktop starten.' }

# Geheimnisse je Installation, einmal erzeugt und danach nie geändert
function New-Secret([int]$length, [string]$chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  $bytes = New-Object byte[] $length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
if (-not (Test-Path $envFile)) {
  $code = New-Secret 8 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  @(
    '# GartenAI im Büro - Geheimnisse dieser Installation. Nicht weitergeben, nicht',
    '# ändern (sonst passen Datenbank und gespeicherte Schlüssel nicht mehr).',
    '# Zusammen mit den Sicherungen (backups\buero) aufbewahren.',
    "POSTGRES_PASSWORD=$(New-Secret 32)",
    "JWT_SECRET=$(New-Secret 48)",
    "SECRET_KEY=$(New-Secret 48)",
    "SETUP_CODE=$($code.Substring(0,4))-$($code.Substring(4,4))",
    'HTTPS_PORT=8443',
    '# Mails verschicken, z.B. SMTP_URL=smtps://benutzer:passwort@mail.example.de:465',
    'SMTP_URL=',
    'MAIL_FROM=',
    'BACKUP_KEEP=14'
  ) | Set-Content -Encoding utf8 $envFile
  Write-Host "OK Geheimnisse erzeugt ($envFile)"
}
$settings = @{}
Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $settings[$k] = $v }
$port = if ($settings['HTTPS_PORT']) { $settings['HTTPS_PORT'] } else { '8443' }

# Adressen im WLAN/LAN (ohne Docker-, WSL- und Hyper-V-Netze)
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^(127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and
    $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker|VirtualBox|VMware'
  } | Select-Object -ExpandProperty IPAddress -Unique)

New-Item -ItemType Directory -Force -Path 'ops\buero\certs', 'backups\buero' | Out-Null
$known = if (Test-Path 'ops\buero\certs\ips') { (Get-Content 'ops\buero\certs\ips' -Raw).Trim() } else { '' }
if (-not (Test-Path 'ops\buero\certs\server.crt') -or $known -ne ($ips -join ' ')) {
  Write-Host 'Erzeuge Zertifikate ...'
  docker run --rm -e 'CA_NAME=GartenAI Buero CA' -v "${PWD}\ops\demo:/demo:ro" -v "${PWD}\ops\buero\certs:/certs" alpine:3.20 sh /demo/make-certs.sh @ips
  if ($LASTEXITCODE -ne 0) { Fail 'Zertifikate konnten nicht erzeugt werden.' }
}

$compose = @('compose', '-f', 'docker-compose.buero.yml', '--env-file', $envFile)
if ($DemoDaten) { $compose += @('--profile', 'demo') }
Write-Host 'Starte GartenAI (beim ersten Mal werden die Images gebaut, das dauert einige Minuten) ...'
docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'Start fehlgeschlagen (siehe oben).' }

$main = "https://localhost:$port"
# Stammzertifikat dieses Rechners für Windows vertrauen (Browser ohne Warnung)
$ca = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Resolve-Path 'ops\buero\certs\ca.crt').Path
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store 'Root', 'CurrentUser'
$store.Open('ReadWrite')
if (-not ($store.Certificates | Where-Object { $_.Thumbprint -eq $ca.Thumbprint })) {
  Write-Host 'Windows fragt jetzt, ob es dem Stammzertifikat von GartenAI vertrauen soll - mit Ja bestätigen.'
  $store.Add($ca)
}
$store.Close()

$status = $null
for ($i = 0; $i -lt 120; $i++) {
  try { $status = Invoke-RestMethod "$main/api/setup/status"; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $status) { Fail 'GartenAI antwortet nicht. Logs: docker compose -f docker-compose.buero.yml logs backend' }

if ($DemoDaten) {
  Write-Host 'Lade die Demo-Daten ...'
  for ($i = 0; $i -lt 180; $i++) {
    $state = (docker @compose ps -a --format '{{.State}} {{.ExitCode}}' demo-data 2>$null) -join ''
    if ($state -eq 'exited 0') { break }
    if ($state -like 'exited*') { docker @compose logs demo-data; Fail 'Demo-Daten fehlgeschlagen.' }
    Start-Sleep -Seconds 2
  }
  $status = Invoke-RestMethod "$main/api/setup/status"
}

# Windows-Firewall: eingehende Verbindungen aus dem Netz erlauben (nur mit Adminrechten)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin -and -not (Get-NetFirewallRule -DisplayName "GartenAI Buero $port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "GartenAI Buero $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private | Out-Null
}

Write-Host ''
Write-Host 'OK GartenAI läuft' -ForegroundColor Green
Write-Host "  Auf diesem Rechner: $main"
$ips | ForEach-Object { Write-Host "  Im Netz (Handy):    https://${_}:$port" }
if ($status.needed) {
  Write-Host ''
  Write-Host '  Ersteinrichtung: im Browser Firma und Zugang anlegen.' -ForegroundColor Yellow
  Write-Host "  Einrichtungscode: $($settings['SETUP_CODE'])" -ForegroundColor Yellow
}
if ($DemoDaten) { Write-Host '  Demo-Zugänge: admin@musterbetrieb.de, buero@..., mitarbeiter@... (Passwort demo12345)' }
Write-Host "  Handy: einmal das Stammzertifikat installieren: https://<Adresse>:$port/demo-ca.crt (siehe BUERO.md)"
if (-not $isAdmin) { Write-Host "  Erreicht das Handy GartenAI nicht: Windows-Firewall für Port $port freigeben (siehe BUERO.md)." }
Write-Host '  Sicherungen: täglich automatisch in backups\buero - Beenden: ops\buero\stop.cmd'
Start-Process $main
