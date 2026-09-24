#!/usr/bin/env bash
# Test der Sicherung mit echtem Stack (docker-compose.prod.yml): Daten anlegen,
# ops/backup.sh, danach geänderte Daten, alles löschen (auch die Volumes),
# frisch starten, ops/restore.sh – dann muss genau der gesicherte Stand da
# sein: Anmeldung, Kunde, Dokument Byte für Byte. Eine beschädigte Sicherung
# wird abgelehnt, ohne etwas zu ändern.
# Aufruf im Projektordner: bash ops/tests/backup-restore.sh  (räumt am Ende auf)
set -euo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=gartenai-backup-test ENV_FILE=/dev/null
POSTGRES_PASSWORD="backup$(date +%s)"
export POSTGRES_PASSWORD JWT_SECRET="backup-test-jwt-secret-0123456789abcdef" COOKIE_SECURE=0
export APP_PORT=8095
COMPOSE=(docker compose -f docker-compose.prod.yml)
BASE="http://localhost:$APP_PORT/api"
WORK=$(mktemp -d)
cleanup() {
  if [ "${1:-0}" != 0 ]; then "${COMPOSE[@]}" logs --no-color --tail=100 || true; fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap 'cleanup $?' EXIT
fail() {
  echo "✗ $*" >&2
  exit 1
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }
wait_up() {
  for _ in $(seq 1 90); do
    curl -fsS "$BASE/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  fail "Backend startet nicht"
}
login() {
  curl -fsS -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@sicherung.de","password":"sicherung-passwort"}' | json 'v.accessToken'
}
customers() { curl -fsS "$BASE/customers?take=100" -H "Authorization: Bearer $1" | json 'v.map(c=>c.name).sort().join("|")'; }

"${COMPOSE[@]}" up -d --build
wait_up
"${COMPOSE[@]}" exec -T -e SETUP_COMPANY_NAME="Sicherung GmbH" -e SETUP_ADMIN_EMAIL=admin@sicherung.de \
  -e SETUP_ADMIN_PASSWORD=sicherung-passwort -e SETUP_ADMIN_FIRST_NAME=Sina -e SETUP_ADMIN_LAST_NAME=Sicher \
  backend node dist/cli/setup-company.js >/dev/null
TOKEN=$(login)
AUTH="Authorization: Bearer $TOKEN"
curl -fsS -X POST "$BASE/customers" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Vor der Sicherung"}' >/dev/null
DOC=$(curl -fsS -X POST "$BASE/documents/upload?documentType=delivery_note" -H "$AUTH" \
  -F "file=@ops/fixtures/smoke-scan.png;type=image/png" | json 'v.id')
echo "✓ Daten angelegt"

BACKUP=$(ENV_FILE=/dev/null ops/backup.sh "$WORK/backups" | tail -n 1)
if ! { [ -f "$BACKUP/gartenai.dump" ] && [ -f "$BACKUP/uploads.tgz" ]; }; then fail "Sicherung unvollständig: $BACKUP"; fi
echo "✓ Sicherung: $BACKUP"

# nach der Sicherung: weitere Daten, dann alles weg
curl -fsS -X POST "$BASE/customers" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Nach der Sicherung"}' >/dev/null
"${COMPOSE[@]}" down -v >/dev/null 2>&1
"${COMPOSE[@]}" up -d
wait_up
if login >/dev/null 2>&1; then fail "frischer Stack hat noch Daten"; fi
echo "✓ Alles gelöscht (auch die Volumes), frisch gestartet"

# beschädigte Sicherung: abgelehnt, nichts geändert
cp -r "$BACKUP" "$WORK/kaputt"
printf 'x' >>"$WORK/kaputt/uploads.tgz"
if ops/restore.sh "$WORK/kaputt" --yes >"$WORK/kaputt.log" 2>&1; then fail "beschädigte Sicherung zurückgespielt"; fi
grep -q "Prüfsummen" "$WORK/kaputt.log" || fail "keine Meldung zur beschädigten Sicherung"
echo "✓ Beschädigte Sicherung abgelehnt"

ops/restore.sh "$BACKUP" --yes
wait_up
TOKEN=$(login) || fail "Anmeldung nach dem Zurückspielen"
[ "$(customers "$TOKEN")" = "Vor der Sicherung" ] || fail "Kunden nach dem Zurückspielen: $(customers "$TOKEN")"
curl -fsS "$BASE/documents/$DOC/download" -H "Authorization: Bearer $TOKEN" -o "$WORK/download.png"
cmp -s "$WORK/download.png" ops/fixtures/smoke-scan.png || fail "Dokument nach dem Zurückspielen anders"
echo "✓ Zurückgespielt: Anmeldung, genau der gesicherte Stand, Dokument Byte für Byte"

# ein zweites Zurückspielen auf den laufenden Stand geht auch
ops/restore.sh "$BACKUP" --yes >/dev/null
wait_up
login >/dev/null || fail "zweites Zurückspielen"
echo "Sicherungstest bestanden."
