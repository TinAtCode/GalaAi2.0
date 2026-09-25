# Cloud-Sicherung einrichten (Windows): ops\buero\cloud-setup.cmd
# 1. rclone fragt nach dem Speicher (Google Drive, OneDrive, Nextcloud/WebDAV,
#    S3 …) und öffnet für die Anmeldung beim Anbieter den Browser.
# 2. Darüber legt das Skript eine Verschlüsselung (rclone "crypt") mit einem
#    zufälligen Passwort an und trägt das Ziel in .env.buero ein.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$envFile = '.env.buero'
$confDir = Join-Path $PWD 'ops\buero\rclone'
function Fail($message) { Write-Host "X $message" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $envFile)) { Fail 'Zuerst einmal ops\buero\start.cmd ausführen.' }
New-Item -ItemType Directory -Force $confDir | Out-Null

Write-Host 'Schritt 1: Cloud-Speicher verbinden. Im Menü n (neu) wählen, einen Namen'
Write-Host 'vergeben (z.B. drive) und den Anbieter auswählen. Zum Schluss q (beenden).'
docker run --rm -it -v "${confDir}:/config/rclone" rclone/rclone:1 config
$remote = Read-Host 'Name des eben angelegten Speichers (z.B. drive)'
if (-not $remote) { Fail 'Kein Name angegeben.' }
$folder = Read-Host 'Ordner im Speicher [GartenAI-Sicherung]'
if (-not $folder) { $folder = 'GartenAI-Sicherung' }

function Secret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ }) }
$password = Secret
$salt = Secret
docker run --rm -v "${confDir}:/config/rclone" rclone/rclone:1 config create gartenai-sicher crypt `
  "remote=${remote}:${folder}" "password=$password" "password2=$salt" --obscure | Out-Null

$lines = Get-Content $envFile | Where-Object { $_ -notmatch '^CLOUD_REMOTE=' -and $_ -notmatch '^CLOUD_CRYPT_PASSWORD' }
$lines += @(
  '# Cloud-Sicherung (ops\buero\cloud-setup) – ohne diese Passwörter lassen sich',
  '# die Sicherungen in der Cloud NICHT wiederherstellen: getrennt aufbewahren!',
  'CLOUD_REMOTE=gartenai-sicher:',
  "CLOUD_CRYPT_PASSWORD=$password",
  "CLOUD_CRYPT_PASSWORD2=$salt"
)
$lines | Set-Content -Encoding utf8 $envFile

Write-Host 'Teste die Verbindung …'
docker run --rm -v "${confDir}:/config/rclone" rclone/rclone:1 mkdir gartenai-sicher:
if ($LASTEXITCODE -ne 0) { Fail 'Keine Verbindung zum Speicher – Einrichtung wiederholen.' }
Write-Host "OK Cloud-Sicherung eingerichtet: ${remote}:${folder} (verschlüsselt)." -ForegroundColor Green
Write-Host '  Bitte die Passwörter CLOUD_CRYPT_PASSWORD/…2 aus .env.buero zusätzlich sicher notieren.'
Write-Host '  Jetzt ops\buero\start.cmd ausführen – die Sicherungen werden stündlich hochgeladen.'
