# Prüft die Windows-Skripte (ops/**/*.ps1) so, wie Windows PowerShell 5.1 sie
# liest: ohne BOM als Windows-1252. Dann werden aus „–“ oder „Ä“ im UTF-8-Text
# Zeichen, die PowerShell als Anführungszeichen wertet, und das Skript bricht
# schon beim Einlesen ab. Deshalb: UTF-8 mit BOM und fehlerfrei parsebar.
#   pwsh -NoProfile -File ops/tests/powershell-check.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$failed = 0
foreach ($file in Get-ChildItem -Path "$root/ops" -Recurse -Filter *.ps1) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = if ($bom) {
    [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  } else {
    [System.Text.Encoding]::GetEncoding(1252).GetString($bytes)
  }
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors) | Out-Null
  $name = $file.FullName.Substring($root.Path.Length + 1)
  if (-not $bom) { Write-Host "X $name ohne UTF-8-BOM (Windows PowerShell 5.1 liest es als Windows-1252)"; $failed++ }
  foreach ($e in $errors) { Write-Host "X ${name}:$($e.Extent.StartLineNumber) $($e.Message)"; $failed++ }
  if ($bom -and -not $errors) { Write-Host "✓ $name" }
}
if ($failed) { exit 1 }
