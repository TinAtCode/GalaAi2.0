# Windows-Skripte von GartenAI im Büro (ops\buero\*.cmd, *.ps1) auf echtem
# Windows mit Windows PowerShell 5.1 – so wie beim Doppelklick über cmd.exe,
# in einem Ordner mit Umlauten, Leerzeichen und „&“ im Pfad. Docker ist eine
# Attrappe (ops\tests\windows\mock-docker.js): Windows-Runner haben keine
# Linux-Container. Echt sind Zertifikate (make-certs.sh mit openssl aus Git),
# der Zertifikatsspeicher von Windows, HTTPS, die Firewall-Regel und die Dateien.
#   powershell -NoProfile -ExecutionPolicy Bypass -File ops\tests\windows-buero.test.ps1
# Nur auf einem Test-Rechner: legt eine Firewall-Regel und ein Stammzertifikat an
# (am Ende wieder entfernt).
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $temp 'Grün & Stein\GartenAI Büro'
$mock = Join-Path $temp 'docker-attrappe'
$failed = 0

function Check($ok, $message) {
  if ($ok) { Write-Host "OK $message" } else { Write-Host "X  $message" -ForegroundColor Red; $script:failed++ }
}
function Calls { @(Get-Content $env:MOCK_DOCKER_LOG -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json }) }
function Line($call) { $call.args -join ' ' }
# Eine .cmd-Datei wie beim Doppelklick über cmd.exe starten; Eingaben kommen
# aus einer leeren Datei (Read-Host und pause warten dann nicht)
function Run-Cmd($name, [string]$extra = '', [int]$timeout = 240) {
  $file = Join-Path $root "ops\buero\$name"
  $out = Join-Path $temp "$name.out.txt"
  $err = Join-Path $temp "$name.err.txt"
  $p = Start-Process cmd.exe -ArgumentList '/c', "`"`"$file`" $extra`"" -WorkingDirectory $temp -NoNewWindow -PassThru `
    -RedirectStandardInput (Join-Path $temp 'leer.txt') -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle # sonst liefert ExitCode unter Windows PowerShell später nichts
  if (-not $p.WaitForExit($timeout * 1000)) {
    Stop-Process -Id $p.Id -Force
    Write-Host (Get-Content $out -Raw)
    throw "$name $extra hängt (wartet auf eine Eingabe oder einen Dialog?)"
  }
  $text = "$(Get-Content $out -Raw)$(Get-Content $err -Raw)"
  Write-Host "--- $name $extra (Exit $($p.ExitCode))"
  Write-Host $text
  [pscustomobject]@{ Code = $p.ExitCode; Text = $text }
}
function Health {
  try { (Invoke-RestMethod 'https://localhost:8443/api/health').status -eq 'ok' } catch { $false }
}

# Aufbau: Kopie der Büro-Dateien, Attrappe vorn im PATH
Remove-Item -Recurse -Force (Split-Path $root), $mock -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $root, "$root\ops", $mock | Out-Null
Copy-Item -Recurse "$repo\ops\buero", "$repo\ops\demo" "$root\ops"
Copy-Item "$repo\docker-compose.buero.yml" $root
Remove-Item -Recurse -Force "$root\ops\buero\certs", "$root\ops\demo\certs" -ErrorAction SilentlyContinue
Copy-Item "$repo\ops\tests\windows\*" $mock
Set-Content -Path (Join-Path $temp 'leer.txt') -Value '' -NoNewline
$env:MOCK_DOCKER_LOG = Join-Path $mock 'aufrufe.jsonl'
$env:MOCK_DOCKER_STATE = $mock
New-Item -ItemType File -Force -Path $env:MOCK_DOCKER_LOG | Out-Null
$realDocker = Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$env:PATH = "$mock;$env:PATH"
Check ((Get-Command docker).Source -like "$mock*") 'Attrappe für docker vorn im PATH'

try {
  # --- erster Start: Geheimnisse, Zertifikate, Start, Stammzertifikat, Firewall
  $first = Run-Cmd 'start.cmd'
  Check ($first.Code -eq 0) 'start.cmd läuft durch'
  $envFile = Join-Path $root '.env.buero'
  Check (Test-Path $envFile) '.env.buero angelegt'
  $settings = @{}
  Get-Content $envFile | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $settings[$k] = $v }
  Check ($settings['SETUP_CODE'] -cmatch '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$') "Einrichtungscode $($settings['SETUP_CODE'])"
  Check ($settings['JWT_SECRET'] -cmatch '^[A-Za-z0-9]{48}$' -and $settings['POSTGRES_PASSWORD'] -cmatch '^[A-Za-z0-9]{32}$') 'Geheimnisse zufällig und lang genug'
  Check ($first.Text -match [regex]::Escape($settings['SETUP_CODE'])) 'Einrichtungscode wird angezeigt'
  Check ((Test-Path "$root\ops\buero\certs\ca.crt") -and (Test-Path "$root\ops\buero\certs\server.key")) 'Zertifikate im Ordner mit Umlauten erzeugt'
  $ca = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 "$root\ops\buero\certs\ca.crt"
  $trusted = @(Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $ca.Thumbprint })
  Check ($trusted.Count -gt 0) 'Stammzertifikat in Windows eingetragen'
  Check (Health) 'HTTPS ohne Zertifikatsfehler (Windows vertraut der eigenen CA)'
  Check ([bool](Get-NetFirewallRule -DisplayName 'GartenAI Buero 8443' -ErrorAction SilentlyContinue)) 'Firewall-Regel für Port 8443'
  $calls = Calls
  $up = @($calls | Where-Object { (Line $_) -eq 'compose -f docker-compose.buero.yml --env-file .env.buero up -d --build' })
  Check ($up.Count -eq 1) 'docker compose up mit Büro-Datei und .env.buero'
  Check ($up.Count -eq 1 -and $up[0].cwd -eq $root) "docker läuft im Installationsordner ($root)"
  $certRuns = @($calls | Where-Object { $_.args -contains '/demo/make-certs.sh' })
  Check ($certRuns.Count -eq 1 -and (Line $certRuns[0]) -like "*$root\ops\buero\certs:/certs*") 'Zertifikate über docker run mit dem richtigen Pfad'

  # --- zweiter Start mit Demo-Daten: nichts neu erzeugt
  $hash = (Get-FileHash $envFile).Hash
  $second = Run-Cmd 'start.cmd' '-DemoDaten'
  Check ($second.Code -eq 0) 'start.cmd -DemoDaten läuft durch'
  Check ((Get-FileHash $envFile).Hash -eq $hash) '.env.buero bleibt unverändert'
  $calls = Calls
  Check (@($calls | Where-Object { $_.args -contains '/demo/make-certs.sh' }).Count -eq 1) 'Zertifikate nicht neu erzeugt'
  Check ([bool]($calls | Where-Object { (Line $_) -like 'compose * --profile demo up -d --build' })) 'Demo-Profil beim Start'
  Check ($second.Text -match 'Demo-Zug') 'Demo-Zugänge angezeigt'

  # --- Sofort-Sicherung
  $backup = Run-Cmd 'backup-now.cmd'
  $dirs = @(Get-ChildItem "$root\backups\buero" -Directory | Sort-Object Name)
  Check ($backup.Code -eq 0 -and $dirs.Count -eq 1 -and (Test-Path "$($dirs[0].FullName)\SHA256SUMS")) 'backup-now.cmd legt eine Sicherung an'

  # --- Zurückspielen mit Pfad voller Sonderzeichen, in der richtigen Reihenfolge
  $before = (Calls).Count
  $restore = Run-Cmd 'restore.cmd' "-Dir `"$($dirs[0].FullName)`" -Yes"
  Check ($restore.Code -eq 0) 'restore.cmd -Yes läuft durch'
  $steps = @(Calls | Select-Object -Skip $before | ForEach-Object { Line $_ })
  $order = @(
    'up -d postgres',
    'sha256sum --quiet -c SHA256SUMS',
    'stop backend frontend',
    '--entrypoint pg_restore',
    'tar xzf /restore/uploads.tgz',
    'up -d backend frontend'
  )
  $at = -1
  $inOrder = $true
  foreach ($step in $order) {
    $next = -1
    for ($i = $at + 1; $i -lt $steps.Count; $i++) { if ($steps[$i] -like "*$step*") { $next = $i; break } }
    if ($next -lt 0) { $inOrder = $false; Write-Host "   fehlt: $step" }
    $at = [Math]::Max($at, $next)
  }
  Check $inOrder 'Zurückspielen: prüfen, anhalten, Datenbank, Dokumente, starten'
  Check ([bool]($steps | Where-Object { $_ -like "*$($dirs[0].FullName):/restore:ro*" })) 'Sicherungsordner mit Umlauten eingebunden'

  # --- beschädigte Sicherung: abgelehnt, nichts angehalten
  $broken = Join-Path "$root\backups\buero" '20000101-000000'
  Copy-Item -Recurse $dirs[0].FullName $broken
  Add-Content -Path "$broken\gartenai.dump" -Value 'kaputt'
  $before = (Calls).Count
  $rejected = Run-Cmd 'restore.cmd' "-Dir `"$broken`" -Yes"
  $steps = @(Calls | Select-Object -Skip $before | ForEach-Object { Line $_ })
  Check ($rejected.Code -ne 0 -and $rejected.Text -match 'Pr.fsummen') 'beschädigte Sicherung abgelehnt'
  Check (-not ($steps | Where-Object { $_ -like '*stop backend*' -or $_ -like '*pg_restore*' })) 'dabei nichts angehalten oder überschrieben'
  Remove-Item -Recurse -Force $broken

  # --- Update (ZIP-Installation ohne Git): erst sichern, dann starten
  $before = (Calls).Count
  $update = Run-Cmd 'update.cmd'
  $steps = @(Calls | Select-Object -Skip $before | ForEach-Object { Line $_ })
  $saved = [Array]::FindIndex([string[]]$steps, [Predicate[string]] { param($s) $s -like '*auto-backup.sh now*' })
  $started = [Array]::FindIndex([string[]]$steps, [Predicate[string]] { param($s) $s -like '*up -d --build*' })
  Check ($update.Code -eq 0) 'update.cmd läuft durch'
  Check ($saved -ge 0 -and $started -gt $saved) 'Update sichert vor dem Neustart'
  Check (@(Get-ChildItem "$root\backups\buero" -Directory).Count -eq 2) 'Sicherung vom Update liegt da'

  # --- Beenden
  $stop = Run-Cmd 'stop.cmd'
  Check ($stop.Code -eq 0 -and [bool]((Calls | Select-Object -Last 1).args -contains 'stop')) 'stop.cmd hält an'
  Start-Sleep -Seconds 1
  Check (-not (Health)) 'danach nicht mehr erreichbar'

  # --- das echte docker compose liest die unter Windows erzeugte .env.buero
  if ($realDocker) {
    Push-Location $root
    & $realDocker.Source compose -f docker-compose.buero.yml --env-file .env.buero --profile demo config --quiet
    $code = $LASTEXITCODE
    Pop-Location
    Check ($code -eq 0) 'docker compose liest die .env.buero von Windows'
  } else {
    Write-Host '(kein echtes docker compose auf diesem Rechner – übersprungen)'
  }
} finally {
  # aufräumen: Server, Firewall-Regel, Stammzertifikat
  if (Test-Path "$mock\server.pid") { Stop-Process -Id (Get-Content "$mock\server.pid") -Force -ErrorAction SilentlyContinue }
  Remove-NetFirewallRule -DisplayName 'GartenAI Buero 8443' -ErrorAction SilentlyContinue
  if (Test-Path "$root\ops\buero\certs\ca.crt") {
    $thumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 "$root\ops\buero\certs\ca.crt").Thumbprint
    Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $thumb } |
      Remove-Item -ErrorAction SilentlyContinue
  }
}

if ($failed) { Write-Host "$failed Prüfung(en) fehlgeschlagen." -ForegroundColor Red; exit 1 }
Write-Host 'Windows-Test Büro bestanden.' -ForegroundColor Green
