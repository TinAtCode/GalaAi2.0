#!/usr/bin/env bash
# Sicherung zurückspielen (von ops/backup.sh):
#   ops/restore.sh backups/20260930-021500 [--yes]
# ERSETZT die aktuelle Datenbank und die Dokumente. Vorher werden die
# Prüfsummen kontrolliert; stimmen sie nicht, passiert nichts. Danach startet
# das Backend neu (Migrationen einer neueren Version laufen dabei nach).
# Einstellungen wie bei ops/backup.sh (ENV_FILE, COMPOSE_FILE).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${1:?Sicherungsordner angeben, z.B. ops/restore.sh backups/20260930-021500}
YES=${2:-}
ENV_FILE=${ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}

log() { printf '%s %s\n' "$(date '+%F %H:%M:%S')" "$*"; }
die() {
  log "FEHLER: $*" >&2
  exit 1
}
ARGS=(-f "$COMPOSE_FILE")
[ -f "$ENV_FILE" ] && ARGS+=(--env-file "$ENV_FILE")
compose() { docker compose "${ARGS[@]}" "$@"; }

if ! { [ -f "$DIR/gartenai.dump" ] && [ -f "$DIR/SHA256SUMS" ]; }; then die "$DIR ist keine Sicherung von ops/backup.sh."; fi
(cd "$DIR" && sha256sum --quiet -c SHA256SUMS) || die "Prüfsummen stimmen nicht – Sicherung beschädigt, nichts geändert."

if [ "$YES" != "--yes" ]; then
  printf 'Aktuelle Datenbank und Dokumente werden durch %s ersetzt. Fortfahren? (ja/nein) ' "$DIR"
  read -r answer
  [ "$answer" = ja ] || die "Abgebrochen – nichts geändert."
fi

log "Halte Backend und App an"
compose up -d postgres
for _ in $(seq 1 30); do compose exec -T postgres pg_isready -U gartenai -d gartenai >/dev/null 2>&1 && break; sleep 2; done
compose stop backend frontend >/dev/null

log "Spiele die Datenbank zurück"
compose exec -T postgres pg_restore -U gartenai -d gartenai --clean --if-exists --no-owner --exit-on-error <"$DIR/gartenai.dump"

if [ -f "$DIR/uploads.tgz" ]; then
  log "Spiele die Dokumente zurück"
  compose run --rm --no-deps -T --entrypoint sh backend -c \
    'find /data/uploads -mindepth 1 -delete && tar xzf - -C /data/uploads' <"$DIR/uploads.tgz"
fi

log "Starte Backend und App"
compose up -d backend frontend
log "Fertig: $DIR zurückgespielt."
