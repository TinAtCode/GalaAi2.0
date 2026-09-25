#!/bin/sh
# Sicherungen verschlüsselt in einen Cloud-Speicher spiegeln (Dienst
# "cloud-backup" in docker-compose.buero.yml, Profil "cloud"). Läuft im
# rclone-Image: stündlich wird backups/buero auf CLOUD_REMOTE gespiegelt –
# dieselben Sicherungen wie lokal (auch das Aufräumen alter Stände).
# CLOUD_REMOTE ist ein rclone-"crypt"-Ziel: Dateien und Namen werden vor dem
# Hochladen auf diesem Rechner verschlüsselt, der Anbieter sieht nur Datensalat.
set -eu
: "${CLOUD_REMOTE:?CLOUD_REMOTE fehlt - bitte ops/buero/cloud-setup ausführen}"
INTERVAL=${CLOUD_INTERVAL:-3600}
log() { echo "$(date '+%F %H:%M:%S') $*"; }

sync_once() {
  # nur fertige Sicherungen (keine *.tmp aus einem laufenden Durchgang)
  if rclone sync /backups "$CLOUD_REMOTE" --exclude '*.tmp/**' --transfers 2 --stats-one-line --stats 0; then
    log "Cloud-Sicherung aktuell ($(find /backups -mindepth 1 -maxdepth 1 -type d ! -name '*.tmp' | wc -l) Stände)"
  else
    log "FEHLER: Cloud-Sicherung fehlgeschlagen – nächster Versuch in $((INTERVAL / 60)) Minuten"
    return 1
  fi
}

if [ "${1:-}" = now ]; then
  sync_once
  exit
fi

log "Cloud-Sicherung aktiv: $CLOUD_REMOTE (alle $((INTERVAL / 60)) Minuten)"
while true; do
  sync_once || true
  sleep "$INTERVAL"
done
