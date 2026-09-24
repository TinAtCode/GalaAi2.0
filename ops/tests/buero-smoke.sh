#!/usr/bin/env bash
# Rauchtest für GartenAI im Büro (docker-compose.buero.yml): Start wie auf dem
# Rechner im Büro über ops/buero/start.sh, dann von außen: eigene Geheimnisse,
# HTTPS mit eigener Zertifizierungsstelle, Ersteinrichtung nur mit Code,
# Anmeldung, automatische Sicherung, Sofort-Sicherung und Zurückspielen.
# Aufruf im Projektordner: bash ops/tests/buero-smoke.sh  (räumt am Ende auf)
set -euo pipefail
cd "$(dirname "$0")/../.."
[ ! -f .env.buero ] || { echo "✗ .env.buero existiert schon – der Test würde sie löschen." >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.buero.yml --env-file .env.buero --profile demo)
cleanup() {
  if [ "${1:-0}" != 0 ]; then "${COMPOSE[@]}" logs --no-color --tail=150 || true; fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  # Sicherungen gehören root (Container) – im Container löschen
  docker run --rm -v "$PWD/backups:/b" alpine:3.20 rm -rf /b/buero >/dev/null 2>&1 || true
  rm -rf ops/buero/certs .env.buero
}
trap 'cleanup $?' EXIT
fail() {
  echo "✗ $*" >&2
  exit 1
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }

ops/buero/start.sh
grep -q '^JWT_SECRET=[A-Za-z0-9]\{48\}$' .env.buero || fail "Geheimnisse nicht erzeugt"
CODE=$(sed -n 's/^SETUP_CODE=//p' .env.buero)
[[ "$CODE" =~ ^[A-Z2-9]{4}-[A-Z2-9]{4}$ ]] || fail "Einrichtungscode: $CODE"
CA=ops/buero/certs/ca.crt
BASE=https://localhost:8443/api
curl -fsS --cacert "$CA" -o /dev/null https://localhost:8443/ || fail "HTTPS mit eigener CA"
echo "✓ Geheimnisse je Installation, HTTPS mit eigener CA"

[ "$(curl -fsS --cacert "$CA" "$BASE/setup/status" | json 'v.needed')" = true ] || fail "Ersteinrichtung nicht angeboten"
setup() {
  curl -sS --cacert "$CA" -o /dev/null -w '%{http_code}' -X POST "$BASE/setup" -H 'Content-Type: application/json' \
    -d "{\"code\":\"$1\",\"companyName\":\"Grün & Stein GmbH\",\"email\":\"clara@gruen-stein.de\",\"password\":\"ein-langes-passwort\",\"firstName\":\"Clara\",\"lastName\":\"Stein\"}"
}
[ "$(setup FALSCH-00)" = 403 ] || fail "Einrichtung mit falschem Code"
[ "$(setup "$CODE")" = 201 ] || fail "Ersteinrichtung"
[ "$(setup "$CODE")" = 403 ] || fail "zweite Einrichtung nicht gesperrt"
login() {
  curl -fsS --cacert "$CA" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"clara@gruen-stein.de","password":"ein-langes-passwort"}' | json 'v.accessToken'
}
TOKEN=$(login) || fail "Anmeldung nach der Einrichtung"
curl -fsS --cacert "$CA" -X POST "$BASE/customers" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Familie Sicher"}' >/dev/null || fail "Kunde anlegen"
echo "✓ Ersteinrichtung mit Code, genau einmal; Anmeldung"

# automatische Sicherung beim Start (es gab noch keine)
for _ in $(seq 1 30); do
  ls backups/buero/*/SHA256SUMS >/dev/null 2>&1 && break
  sleep 2
done
ls backups/buero/*/SHA256SUMS >/dev/null 2>&1 || fail "keine automatische Sicherung"
sleep 1 # Sofort-Sicherung bekommt einen neuen Zeitstempel
ops/buero/backup-now.sh
LATEST=$(find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.tmp' | sort | tail -n 1)
[ "$(find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.tmp' | wc -l)" -ge 2 ] || fail "Sofort-Sicherung fehlt"
echo "✓ automatische und Sofort-Sicherung ($LATEST)"

# nach der Sicherung angelegter Kunde verschwindet beim Zurückspielen
curl -fsS --cacert "$CA" -X POST "$BASE/customers" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Nach der Sicherung"}' >/dev/null
ops/buero/restore.sh "$LATEST" --yes
for _ in $(seq 1 60); do curl -fsS --cacert "$CA" -o /dev/null "$BASE/health" 2>/dev/null && break; sleep 2; done
TOKEN=$(login) || fail "Anmeldung nach dem Zurückspielen"
names=$(curl -fsS --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/customers" | json 'JSON.stringify(v.items ?? v)')
grep -q 'Familie Sicher' <<<"$names" || fail "Kunde aus der Sicherung fehlt: $names"
if grep -q 'Nach der Sicherung' <<<"$names"; then fail "Zurückspielen hat nichts ersetzt"; fi
echo "✓ Zurückspielen"
echo "Rauchtest Büro bestanden."
