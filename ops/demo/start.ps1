# Demo starten (Windows): Doppelklick auf start.cmd oder
#   powershell -ExecutionPolicy Bypass -File ops\demo\start.ps1 [-Https]
# -Https: HTTPS mit eigener Demo-Zertifizierungsstelle (App auf dem Handy
#         installierbar, auch ohne Netz). Braucht Docker Desktop.
param([switch]$Https)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$port = if ($env:DEMO_PORT) { $env:DEMO_PORT } else { '8080' }
$httpsPort = if ($env:DEMO_HTTPS_PORT) { $env:DEMO_HTTPS_PORT } else { '8443' }

function Fail($message) { Write-Host "X $message" -ForegroundColor Red; Read-Host 'Enter zum Schließen'; exit 1 }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker fehlt - bitte Docker Desktop installieren und starten.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker läuft nicht - bitte Docker Desktop starten.' }

# Adressen im WLAN/LAN (ohne Docker-, WSL- und Hyper-V-Netze)
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^(127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and
    $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker|VirtualBox|VMware'
  } | Select-Object -ExpandProperty IPAddress -Unique)
if ($ips.Count -eq 0) { Write-Host 'Hinweis: keine Adresse im WLAN gefunden - die Demo läuft nur auf diesem Rechner.' }

$urls = @($ips | ForEach-Object { if ($Https) { "https://${_}:$httpsPort" } else { "http://${_}:$port" } })
$env:DEMO_URLS = $urls -join ','
$compose = @('compose', '-f', 'docker-compose.demo.yml')

if ($Https) {
  New-Item -ItemType Directory -Force -Path 'ops\demo\certs' | Out-Null
  $known = if (Test-Path 'ops\demo\certs\ips') { (Get-Content 'ops\demo\certs\ips' -Raw).Trim() } else { '' }
  if (-not (Test-Path 'ops\demo\certs\server.crt') -or $known -ne ($ips -join ' ')) {
    Write-Host 'Erzeuge Demo-Zertifikate ...'
    docker run --rm -v "${PWD}\ops\demo:/demo:ro" -v "${PWD}\ops\demo\certs:/certs" alpine:3.20 sh /demo/make-certs.sh @ips
    if ($LASTEXITCODE -ne 0) { Fail 'Zertifikate konnten nicht erzeugt werden.' }
  }
  $compose += @('--profile', 'https')
}

Write-Host 'Starte die Demo (beim ersten Mal werden die Images gebaut, das dauert einige Minuten) ...'
docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'Start fehlgeschlagen (siehe oben).' }

Write-Host 'Warte auf die Beispieldaten ...'
for ($i = 0; $i -lt 180; $i++) {
  $state = (docker @compose ps -a --format '{{.State}} {{.ExitCode}}' demo-data 2>$null) -join ''
  if ($state -eq 'exited 0') { break }
  if ($state -like 'exited*') { docker @compose logs demo-data; Fail 'Beispieldaten fehlgeschlagen. Neu anfangen: ops\demo\reset.cmd' }
  Start-Sleep -Seconds 2
}

# Windows-Firewall: eingehende Verbindungen aus dem WLAN erlauben (nur mit Adminrechten)
$rulePort = if ($Https) { $httpsPort } else { $port }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin -and -not (Get-NetFirewallRule -DisplayName "GartenAI Demo $rulePort" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "GartenAI Demo $rulePort" -Direction Inbound -Protocol TCP -LocalPort $rulePort -Action Allow -Profile Private | Out-Null
}

$main = if ($Https) { "https://localhost:$httpsPort" } else { "http://localhost:$port" }
Write-Host ''
Write-Host 'OK GartenAI-Demo läuft' -ForegroundColor Green
Write-Host "  Auf diesem Rechner: $main"
$urls | ForEach-Object { Write-Host "  Im WLAN (Handy):   $_" }
Write-Host '  Anmeldungen (Passwort demo12345): admin@ (Chef), buero@ (Büro), mitarbeiter@musterbetrieb.de'
Write-Host '  Die Anmeldeseite zeigt einen QR-Code für das Handy.'
if ($Https) { Write-Host "  Handy: zuerst $($urls[0])/demo-ca.crt öffnen und das Zertifikat installieren (siehe DEMO.md)." }
if (-not $isAdmin) { Write-Host "  Erreicht das Handy die Demo nicht: Windows-Firewall für Port $rulePort freigeben (siehe DEMO.md)." }
Write-Host '  Beenden: ops\demo\stop.cmd - Zurücksetzen: ops\demo\reset.cmd'
Start-Process $main
