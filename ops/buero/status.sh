#!/usr/bin/env bash
# GartenAI im Büro prüfen (macOS/Linux): ops/buero/status.sh [--support]
# Zeigt, ob alle Dienste laufen, HTTPS antwortet, die letzte Sicherung aktuell
# und unversehrt ist, genug Speicher frei ist und wann das Zertifikat abläuft.
#   --support  zusätzlich ein Support-Paket für die IT (backups/support-….tar.gz):
#              diese Übersicht, Container-Status und die letzten Log-Zeilen –
#              ohne Passwörter und Schlüssel aus .env.buero
# Ergebnis 0 = alles in Ordnung, 1 = mindestens ein Problem.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ENV_FILE=.env.buero
SUPPORT=0
for arg in "$@"; do
  case "$arg" in
    --support) SUPPORT=1 ;;
    *) echo "Unbekannte Option: $arg (erlaubt: --support)" >&2; exit 2 ;;
  esac
done

ok() { echo "✓ $*"; }
warn() { echo "! $*"; }
bad() { echo "✗ $*"; }

report() {
  [ -f "$ENV_FILE" ] || { bad "Noch nicht eingerichtet ($ENV_FILE fehlt) – zuerst ops/buero/start.sh"; return; }
  PORT=$(sed -n 's/^HTTPS_PORT=//p' "$ENV_FILE" | tail -n 1)
  PORT=${PORT:-8443}
  COMPOSE=(docker compose -f docker-compose.buero.yml --env-file "$ENV_FILE")

  if ! command -v docker >/dev/null 2>&1; then
    bad "Docker fehlt – bitte Docker Desktop installieren."
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    bad "Docker läuft nicht – bitte Docker Desktop starten, dann ops/buero/start.sh."
    return
  fi

  # Dienste: laufen sie, und melden sie sich gesund (falls sie das prüfen)?
  for svc in postgres backend frontend https backup; do
    state=$("${COMPOSE[@]}" ps -a --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | head -n 1)
    case "$state" in
      'running healthy' | 'running ' | running) ok "Dienst $svc läuft" ;;
      'running starting') warn "Dienst $svc startet noch" ;;
      '') bad "Dienst $svc ist nicht gestartet – ops/buero/start.sh" ;;
      *) bad "Dienst $svc: $state – Logs: docker compose -f docker-compose.buero.yml logs $svc" ;;
    esac
  done

  # HTTPS mit der eigenen Zertifizierungsstelle
  health=$(curl -fsS --connect-timeout 5 --max-time 15 --cacert ops/buero/certs/ca.crt \
    "https://localhost:$PORT/api/health" 2>/dev/null)
  if [ -n "$health" ]; then
    version=$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    ok "GartenAI antwortet unter https://localhost:$PORT${version:+ (Version $version)}"
  else
    bad "GartenAI antwortet nicht unter https://localhost:$PORT"
  fi

  # Zertifikat: Alter der Datei (gilt 825 Tage, start.sh erneuert nach 760)
  if [ -f ops/buero/certs/server.crt ]; then
    if [ -n "$(find ops/buero/certs/server.crt -mtime +820 2>/dev/null)" ]; then
      bad "Zertifikat abgelaufen oder kurz davor – ops/buero/start.sh erneuert es"
    elif [ -n "$(find ops/buero/certs/server.crt -mtime +760 2>/dev/null)" ]; then
      warn "Zertifikat läuft bald ab – beim nächsten ops/buero/start.sh wird es erneuert"
    else
      ok "Zertifikat gültig"
    fi
  else
    bad "Zertifikat fehlt – ops/buero/start.sh"
  fi

  # Sicherungen: jüngste nicht älter als 36 Stunden, Prüfsummen stimmen
  newest=$(find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20[0-9]*-[0-9]*' ! -name '*.tmp' 2>/dev/null |
    sort | tail -n 1)
  count=$(find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20[0-9]*-[0-9]*' ! -name '*.tmp' 2>/dev/null |
    wc -l | tr -d ' ')
  if [ -z "$newest" ]; then
    bad "Noch keine Sicherung – ops/buero/backup-now.sh"
  else
    size=$(du -sh "$newest" 2>/dev/null | cut -f1)
    if [ -n "$(find "$newest" -maxdepth 0 -mmin +2160 2>/dev/null)" ]; then
      bad "Letzte Sicherung $(basename "$newest") ist älter als 36 Stunden – läuft der Dienst backup?"
    else
      ok "Letzte Sicherung $(basename "$newest") ($size, $count Sicherungen vorhanden)"
    fi
    if command -v sha256sum >/dev/null 2>&1; then sums=(sha256sum); else sums=(shasum -a 256); fi
    if [ ! -f "$newest/SHA256SUMS" ]; then
      bad "Letzte Sicherung ohne Prüfsummen (unvollständig?)"
    elif (cd "$newest" && "${sums[@]}" -c SHA256SUMS >/dev/null 2>&1); then
      ok "Letzte Sicherung unversehrt (Prüfsummen stimmen)"
    else
      bad "Letzte Sicherung beschädigt (Prüfsummen stimmen nicht) – sofort neu sichern"
    fi
    if "${COMPOSE[@]}" logs --no-color --since 48h backup 2>/dev/null | grep -q 'FEHLER'; then
      bad "Die automatische Sicherung meldet Fehler – docker compose -f docker-compose.buero.yml logs backup"
    fi
  fi

  # Speicherplatz dort, wo die Sicherungen liegen
  free_kb=$(df -Pk backups/buero 2>/dev/null | awk 'NR == 2 { print $4 }')
  if [ -n "$free_kb" ]; then
    free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 2 ]; then
      bad "Nur noch ${free_gb} GB frei – Speicher freigeben oder BACKUP_KEEP senken"
    elif [ "$free_gb" -lt 10 ]; then
      warn "Nur noch ${free_gb} GB frei"
    else
      ok "${free_gb} GB frei"
    fi
  fi
}

output=$(report)
echo "$output"
problems=$(printf '%s\n' "$output" | grep -c '^✗' || true)
echo
if [ "$problems" = 0 ]; then echo "Alles in Ordnung."; else echo "$problems Problem(e) gefunden."; fi

if [ "$SUPPORT" = 1 ]; then
  stamp=$(date +%Y%m%d-%H%M%S)
  dir="backups/support-$stamp"
  mkdir -p "$dir"
  COMPOSE=(docker compose -f docker-compose.buero.yml --env-file "$ENV_FILE")
  {
    echo "GartenAI Support-Paket $stamp"
    echo "System: $(uname -a)"
    echo "Git: $(git describe --always --dirty 2>/dev/null || echo unbekannt)"
    echo
    echo "$output"
  } >"$dir/status.txt"
  docker version >"$dir/docker-version.txt" 2>&1
  "${COMPOSE[@]}" ps -a >"$dir/container.txt" 2>&1
  for svc in postgres backend frontend https backup cloud-backup tunnel; do
    "${COMPOSE[@]}" logs --no-color --tail=500 "$svc" >"$dir/log-$svc.txt" 2>&1 || true
  done
  # Einstellungen ohne Werte: nur, welche gesetzt sind (keine Passwörter oder Schlüssel)
  if [ -f "$ENV_FILE" ]; then
    sed -n 's/^\([A-Z_]*\)=\(..*\)$/\1 gesetzt/p; s/^\([A-Z_]*\)=$/\1 leer/p' "$ENV_FILE" >"$dir/einstellungen.txt"
  fi
  tar czf "$dir.tar.gz" -C backups "support-$stamp" && rm -rf "$dir"
  echo
  echo "Support-Paket: $dir.tar.gz"
  echo "Es enthält keine Passwörter oder Schlüssel. Die Protokolle können Namen und"
  echo "E-Mail-Adressen von Nutzern enthalten – nur an die zuständige IT weitergeben."
fi

[ "$problems" = 0 ]
