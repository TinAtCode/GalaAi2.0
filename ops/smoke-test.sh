#!/usr/bin/env bash
# Rauchtest für docker-compose.prod.yml: baut und startet den ganzen Stack
# und prüft ihn von außen über nginx (Port 8080): Einrichtung, Anmeldung,
# Rechte, Upload mit Texterkennung, Frontend, Neustart mit Migrationen.
# Aufruf im Projektordner: bash ops/smoke-test.sh  (räumt am Ende auf)
set -euo pipefail
cd "$(dirname "$0")/.."

export POSTGRES_PASSWORD="smoke-$(date +%s)-postgres"
export JWT_SECRET="smoke-test-jwt-secret-$(date +%s)-0123456789abcdef"
export COOKIE_SECURE=0
COMPOSE="docker compose -p gartenai-smoke -f docker-compose.prod.yml"
BASE=http://localhost:8080
cleanup() {
  if [ "${1:-0}" != 0 ]; then $COMPOSE logs --no-color --tail=200 || true; fi
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}
trap 'cleanup $?' EXIT

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }
wait_for() {
  for _ in $(seq 1 60); do
    if curl -fsS "$1" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Nicht erreichbar: $1" >&2
  return 1
}

$COMPOSE up -d --build
wait_for "$BASE/api/health"
echo "✓ Backend über nginx erreichbar, Migrationen angewendet"

$COMPOSE exec -T \
  -e SETUP_COMPANY_NAME="Rauchtest GaLaBau GmbH" \
  -e SETUP_ADMIN_EMAIL="admin@rauchtest.de" \
  -e SETUP_ADMIN_PASSWORD="rauchtest-passwort" \
  -e SETUP_ADMIN_FIRST_NAME="Rita" \
  -e SETUP_ADMIN_LAST_NAME="Rauch" \
  backend node dist/cli/setup-company.js
echo "✓ Firma und Administrator angelegt"

TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -H 'X-Requested-With: fetch' \
  -d '{"email":"admin@rauchtest.de","password":"rauchtest-passwort"}' | json 'v.accessToken')
AUTH="Authorization: Bearer $TOKEN"
curl -fsS "$BASE/api/auth/me" -H "$AUTH" | json 'v.permissions.includes("document.delete") ? "ok" : process.exit(1)' >/dev/null
echo "✓ Anmeldung mit allen Rechten"

# Bild (gerenderte Seite, keine Textebene) -> echte Bild-OCR mit den im
# Image enthaltenen Sprachdaten; die Datei landet im Volume
DOC=$(curl -fsS -X POST "$BASE/api/documents/upload?documentType=delivery_note&ocr=1" -H "$AUTH" \
  -H 'X-Requested-With: fetch' -F "file=@ops/fixtures/smoke-scan.png;type=image/png" | json 'v.id')
for _ in $(seq 1 60); do
  STATUS=$(curl -fsS "$BASE/api/documents/$DOC" -H "$AUTH" | json 'v.ocrStatus')
  [ "$STATUS" = done ] && break
  [ "$STATUS" = failed ] && { echo "Texterkennung fehlgeschlagen" >&2; exit 1; }
  sleep 1
done
curl -fsS "$BASE/api/documents/$DOC" -H "$AUTH" | json 'v.ocrText.includes("Rasengitter") ? "ok" : process.exit(1)' >/dev/null
curl -fsS "$BASE/api/documents/$DOC/download" -H "$AUTH" -o /tmp/smoke-download.png
cmp -s /tmp/smoke-download.png ops/fixtures/smoke-scan.png
echo "✓ Upload mit Bild-Texterkennung (Sprachdaten im Image), Download aus dem Volume"

curl -fsS "$BASE/" | grep -q '<div id="root">'
curl -fsS "$BASE/projekte/irgendwas" | grep -q '<div id="root">'
echo "✓ Frontend und Single-Page-Routing"

# neu erzeugen (neue IP): nginx muss das Backend neu auflösen
$COMPOSE up -d --force-recreate --no-deps backend
sleep 3
wait_for "$BASE/api/health"
curl -fsS "$BASE/api/documents/$DOC" -H "$AUTH" >/dev/null
echo "✓ Backend neu erzeugt: Migrationen idempotent, nginx findet es wieder, Daten und Sitzung erhalten"
