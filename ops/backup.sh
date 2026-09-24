#!/usr/bin/env bash
# Sicherung von Datenbank und Dokumenten (docker-compose.prod.yml).
#   ops/backup.sh [ZIELORDNER]     Standard: backups/
# Legt ZIELORDNER/<Datum-Uhrzeit>/ an mit
#   gartenai.dump   Datenbank (pg_dump, Custom-Format)
#   uploads.tgz     Dokumente aus dem Volume (entfällt mit STORAGE=s3 –
#                   den Objektspeicher sichert der Anbieter bzw. dessen Versionierung)
#   SHA256SUMS      Prüfsummen; ops/restore.sh prüft sie vor dem Zurückspielen
# Die Datenbank-Sicherung wird gleich nach dem Schreiben auf Lesbarkeit geprüft.
# Einstellungen: ENV_FILE (Standard .env.production), COMPOSE_FILE,
# KEEP (so viele Sicherungen behalten, Standard 14). Für einen Cronjob, z.B.:
#   15 2 * * * cd /srv/gartenai && ops/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${1:-backups}
ENV_FILE=${ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
KEEP=${KEEP:-14}

log() { printf '%s %s\n' "$(date '+%F %H:%M:%S')" "$*"; }
die() {
  log "FEHLER: $*" >&2
  exit 1
}
ARGS=(-f "$COMPOSE_FILE")
[ -f "$ENV_FILE" ] && ARGS+=(--env-file "$ENV_FILE")
compose() { docker compose "${ARGS[@]}" "$@"; }
storage=${STORAGE:-}
[ -z "$storage" ] && [ -f "$ENV_FILE" ] && storage=$(sed -n 's/^STORAGE=//p' "$ENV_FILE" | tail -n 1)

compose ps --status running --services 2>/dev/null | grep -qx postgres || die "Die Datenbank läuft nicht."
DIR="$TARGET/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
trap 'rm -rf "$DIR"; die "Sicherung abgebrochen – unvollständige Sicherung entfernt."' ERR

log "Sichere Datenbank"
compose exec -T postgres pg_dump -U gartenai -Fc gartenai >"$DIR/gartenai.dump"
compose exec -T postgres pg_restore --list <"$DIR/gartenai.dump" >/dev/null
if [ "$storage" != s3 ]; then
  log "Sichere Dokumente"
  compose exec -T backend tar czf - -C /data/uploads . >"$DIR/uploads.tgz"
  tar tzf "$DIR/uploads.tgz" >/dev/null
fi
(cd "$DIR" && sha256sum ./* >SHA256SUMS)
trap - ERR

# alte Sicherungen aufräumen (nur Ordner mit Datums-Namen)
find "$TARGET" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]' |
  sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -rf "$old"; done

log "Fertig: $DIR ($(du -sh "$DIR" | cut -f1))"
echo "$DIR"
