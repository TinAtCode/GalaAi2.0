#!/bin/sh
# Automatische Sicherung im Container (docker-compose.buero.yml, Dienst
# "backup"): stündlich prüfen, ob die letzte Sicherung älter als ein Tag ist,
# dann Datenbank und Dokumente sichern. So entsteht die Sicherung auch, wenn
# der Rechner nachts aus ist. Format wie ops/backup.sh (ops/restore.sh spielt
# sie zurück). KEEP Sicherungen bleiben erhalten.
set -eu
KEEP=${KEEP:-14}
MAX_AGE_MIN=${MAX_AGE_MIN:-1380} # 23 Stunden
log() { echo "$(date '+%F %H:%M:%S') $*"; }

backup() {
  dir="/backups/$(date +%Y%m%d-%H%M%S)"
  tmp="$dir.tmp"
  mkdir -p "$tmp"
  if pg_dump -h postgres -U gartenai -Fc gartenai >"$tmp/gartenai.dump" &&
    pg_restore --list "$tmp/gartenai.dump" >/dev/null &&
    tar czf "$tmp/uploads.tgz" -C /uploads . &&
    (cd "$tmp" && sha256sum ./* >SHA256SUMS); then
    mv "$tmp" "$dir"
    log "Sicherung fertig: $(basename "$dir") ($(du -sh "$dir" | cut -f1))"
  else
    rm -rf "$tmp"
    log "FEHLER: Sicherung fehlgeschlagen"
    return 1
  fi
  find /backups -mindepth 1 -maxdepth 1 -type d -name '20[0-9]*-[0-9]*' ! -name '*.tmp' |
    sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -rf "$old"; done
}

# Sofort-Sicherung auf Anfrage: docker compose ... exec backup sh /auto-backup.sh now
if [ "${1:-}" = now ]; then
  backup
  exit
fi

log "Automatische Sicherung aktiv (täglich, $KEEP Sicherungen)"
rm -rf /backups/*.tmp
while true; do
  recent=$(find /backups -mindepth 1 -maxdepth 1 -type d -name '20[0-9]*-[0-9]*' ! -name '*.tmp' -mmin -"$MAX_AGE_MIN" | head -n 1)
  [ -n "$recent" ] || backup || true
  sleep 3600
done
