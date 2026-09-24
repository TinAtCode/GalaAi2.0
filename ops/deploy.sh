#!/usr/bin/env bash
# Neue Version auf dem Server ausrollen – von Hand oder aus GitHub Actions
# (.github/workflows/deploy.yml). Läuft im Projektordner auf dem Server
# (git-Checkout mit .env.production).
#
#   ops/deploy.sh v1.4.0        Version ausrollen (Git-Tag bzw. Commit + Images dieser Version)
#   ops/deploy.sh --rollback    zurück auf die zuletzt laufende Version
#
# Ablauf: Code des Stands holen (Compose-Datei, Skripte) -> Images laden ->
# Datenbank und Dokumente sichern -> neu starten (Migrationen laufen beim
# Start des Backends) -> prüfen, dass die neue Version antwortet. Klappt das
# nicht, läuft wieder die vorige Version. Die Datenbank wird dabei NICHT
# automatisch zurückgespielt (Migrationen sind vorwärts gerichtet); die
# Sicherung von eben liegt in .deploy/backups, der Befehl steht in der Ausgabe.
#
# Einstellungen (Umgebung):
#   GARTENAI_IMAGE   Registry-Pfad der Images, z.B. ghcr.io/firma/gartenai (Pflicht)
#   ENV_FILE         Standard .env.production
#   HEALTH_URL       Standard http://localhost:$APP_PORT/api/health (APP_PORT aus ENV_FILE, sonst 8080)
#   HEALTH_TIMEOUT   Sekunden bis zur Aufgabe, Standard 180
#   KEEP_BACKUPS     so viele Sicherungen behalten, Standard 10
#   SKIP_BACKUP=1    keine Sicherung (nur für Tests)
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=${ENV_FILE:-.env.production}
STATE=.deploy
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}
KEEP_BACKUPS=${KEEP_BACKUPS:-10}

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() {
  log "FEHLER: $*" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || die "$ENV_FILE fehlt (Vorlage: .env.production.example)."
[ -n "${GARTENAI_IMAGE:-}" ] || die "GARTENAI_IMAGE ist nicht gesetzt (z.B. ghcr.io/firma/gartenai)."
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
APP_PORT=$(env_value APP_PORT)
HEALTH_URL=${HEALTH_URL:-http://localhost:${APP_PORT:-8080}/api/health}
STORAGE_MODE=$(env_value STORAGE)

mkdir -p "$STATE/backups"
# nie zwei Läufe gleichzeitig
exec 9>"$STATE/lock"
flock -n 9 || die "Es läuft bereits ein Ausrollen."

compose() { GARTENAI_VERSION="$1" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "${@:2}"; }

CURRENT=$(cat "$STATE/current" 2>/dev/null || true)
CURRENT_REF=$(cat "$STATE/current-ref" 2>/dev/null || git rev-parse HEAD)

if [ "${1:-}" = "--rollback" ]; then
  TARGET=$(cat "$STATE/previous" 2>/dev/null || true)
  TARGET_REF=$(cat "$STATE/previous-ref" 2>/dev/null || true)
  if ! { [ -n "$TARGET" ] && [ -n "$TARGET_REF" ]; }; then die "Keine vorige Version bekannt."; fi
else
  TARGET=${1:?Version angeben, z.B. ops/deploy.sh v1.4.0}
  git fetch --quiet --tags origin
  TARGET_REF=$(git rev-parse --verify --quiet "$TARGET^{commit}" || git rev-parse --verify --quiet "origin/$TARGET^{commit}" || true)
  [ -n "$TARGET_REF" ] || die "Version $TARGET gibt es im Repository nicht."
fi
[ "$TARGET" != "$CURRENT" ] || log "Version $TARGET läuft bereits – wird neu gestartet."

# Antwortet die erwartete Version? (GET /api/health liefert die Version)
healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) body
  while [ "$SECONDS" -lt "$deadline" ]; do
    body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)
    case "$body" in *"\"version\":\"$1\""*) return 0 ;; esac
    sleep 3
  done
  return 1
}

log "Rolle $TARGET aus (läuft: ${CURRENT:-unbekannt})"
git -c advice.detachedHead=false checkout --quiet --detach "$TARGET_REF"

log "Lade Images $GARTENAI_IMAGE-{backend,frontend}:$TARGET"
compose "$TARGET" pull --quiet backend frontend || {
  git checkout --quiet --detach "$CURRENT_REF"
  die "Images für $TARGET nicht gefunden – nichts geändert."
}

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$STATE/backups/$STAMP-${CURRENT:-start}"
if [ "${SKIP_BACKUP:-0}" != 1 ] && compose "$CURRENT" ps --status running --services 2>/dev/null | grep -qx postgres; then
  log "Sichere Datenbank nach $BACKUP.dump"
  compose "$CURRENT" exec -T postgres pg_dump -U gartenai -Fc gartenai >"$BACKUP.dump" || die "Sicherung der Datenbank fehlgeschlagen – nichts geändert."
  if [ "$STORAGE_MODE" != s3 ]; then
    log "Sichere Dokumente nach $BACKUP-uploads.tgz"
    compose "$CURRENT" exec -T backend tar czf - -C /data/uploads . >"$BACKUP-uploads.tgz" || die "Sicherung der Dokumente fehlgeschlagen – nichts geändert."
  fi
  # alte Sicherungen aufräumen
  find "$STATE/backups" -maxdepth 1 -type f -name '*.dump' | sort -r | tail -n +"$((KEEP_BACKUPS + 1))" | while read -r old; do
    rm -f "$old" "${old%.dump}-uploads.tgz"
  done
fi

log "Starte $TARGET"
compose "$TARGET" up -d --no-build --remove-orphans

if healthy "$TARGET"; then
  if [ "$TARGET" != "$CURRENT" ]; then
    [ -n "$CURRENT" ] && printf '%s\n' "$CURRENT" >"$STATE/previous" && printf '%s\n' "$CURRENT_REF" >"$STATE/previous-ref"
  fi
  printf '%s\n' "$TARGET" >"$STATE/current"
  printf '%s\n' "$TARGET_REF" >"$STATE/current-ref"
  log "Fertig: $TARGET läuft."
  exit 0
fi

log "Version $TARGET antwortet nicht – Logs:"
compose "$TARGET" logs --no-color --tail=80 backend || true
if [ -n "$CURRENT" ]; then
  log "Zurück auf $CURRENT"
  git checkout --quiet --detach "$CURRENT_REF"
  compose "$CURRENT" up -d --no-build --remove-orphans
  if healthy "$CURRENT"; then
    log "$CURRENT läuft wieder."
  else
    log "Auch $CURRENT antwortet nicht – bitte von Hand prüfen."
  fi
  [ -f "$BACKUP.dump" ] &&
    log "Falls Migrationen von $TARGET die Datenbank verändert haben: docker compose -f docker-compose.prod.yml --env-file $ENV_FILE exec -T postgres pg_restore -U gartenai -d gartenai --clean < $BACKUP.dump"
fi
die "Ausrollen von $TARGET fehlgeschlagen."
