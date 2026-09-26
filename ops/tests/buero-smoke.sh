#!/usr/bin/env bash
# Rauchtest für GartenAI im Büro (docker-compose.buero.yml): Start wie auf dem
# Rechner im Büro über ops/buero/start.sh, dann von außen: eigene Geheimnisse,
# HTTPS mit eigener Zertifizierungsstelle, Ersteinrichtung nur mit Code,
# Anmeldung, automatische Sicherung, Sofort-Sicherung und Zurückspielen,
# Beenden und neu Starten, Neustart von Docker (wie nach dem Hochfahren) und
# das Update. Ist Playwright installiert (frontend/node_modules), läuft die
# Checkliste BUERO-TEST.md im Browser mit (frontend/tests/buero): Einrichtung,
# Zugänge je Rolle, alle Bereiche, Handy mit installierbarer App ohne Netz.
# Zum Schluss der Umzug auf einen Server: die letzte Sicherung des Büro-Rechners
# mit ops/restore.sh in docker-compose.prod.yml einspielen, mit dem SECRET_KEY
# aus .env.buero – danach ist alles da, auch Dokumente und verschlüsselte Schlüssel.
# Aufruf im Projektordner: bash ops/tests/buero-smoke.sh  (räumt am Ende auf)
set -euo pipefail
cd "$(dirname "$0")/../.."
[ ! -f .env.buero ] || { echo "✗ .env.buero existiert schon – der Test würde sie löschen." >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.buero.yml --env-file .env.buero --profile demo)
LAST_ERROR=""
SERVER=(docker compose -p gartenai-umzug-test -f docker-compose.prod.yml)
# fürs Aufräumen reichen Platzhalter (die Datei verlangt die Variablen)
SERVER_CLEAN=(env POSTGRES_PASSWORD=x JWT_SECRET=x "${SERVER[@]}")
cleanup() {
  if [ "${1:-0}" != 0 ]; then
    # Zustand vor dem Aufräumen festhalten; die Fehlermeldung am Ende wiederholen
    echo "── Container" >&2
    "${COMPOSE[@]}" ps -a >&2 || true
    for svc in https frontend backup postgres backend; do
      echo "── Logs $svc" >&2
      "${COMPOSE[@]}" logs --no-color --tail=40 "$svc" >&2 || true
    done
    echo "── Erreichbarkeit" >&2
    for url in https://localhost:8443/ https://127.0.0.1:8443/; do
      command curl -sk --connect-timeout 5 --max-time 10 -o /dev/null -w "$url → %{http_code}\n" "$url" >&2 || echo "$url → keine Verbindung" >&2
    done
  fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "${1:-0}" != 0 ]; then "${SERVER_CLEAN[@]}" logs --no-color --tail=40 2>/dev/null || true; fi
  "${SERVER_CLEAN[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  # Sicherungen gehören root (Container) – im Container löschen
  docker run --rm -v "$PWD/backups:/b" alpine:3.20 rm -rf /b/buero >/dev/null 2>&1 || true
  rm -rf ops/buero/certs .env.buero
  if [ "${1:-0}" != 0 ]; then echo "✗ Abbruch (Exit $1): ${LAST_ERROR:-siehe oben}" >&2; fi
}
trap 'cleanup $?' EXIT
fail() {
  LAST_ERROR="$*"
  echo "✗ $*" >&2
  exit 1
}
# Keine Anfrage darf ewig hängen (sonst läuft der CI-Job bis zum Zeitlimit ohne Hinweis)
curl() { command curl --connect-timeout 5 --max-time 120 "$@"; }
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
if [ -x frontend/node_modules/.bin/playwright ]; then
  # In der CI das Stammzertifikat im Browser installieren wie auf dem Büro-Rechner
  # (nie auf dem eigenen Rechner: das würde dessen Zertifikatsspeicher ändern)
  TRUSTED=0
  if [ -n "${CI:-}" ] && command -v certutil >/dev/null 2>&1; then
    mkdir -p "$HOME/.pki/nssdb"
    [ -f "$HOME/.pki/nssdb/cert9.db" ] || certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password
    certutil -d "sql:$HOME/.pki/nssdb" -A -t 'C,,' -n 'GartenAI Buero CA' -i "$CA"
    TRUSTED=1
  fi
  LAN=$(cut -d' ' -f1 <ops/buero/certs/ips)
  (cd frontend && BUERO_SETUP_CODE="$CODE" BUERO_CA_TRUSTED="$TRUSTED" BUERO_LAN_URL="${LAN:+https://$LAN:8443}" \
    npx playwright test -c playwright.buero.config.ts) || fail "Checkliste im Browser"
  echo "✓ Checkliste im Browser (Einrichtung, Rollen, alle Bereiche, Handy)"
else
  [ "$(setup "$CODE")" = 201 ] || fail "Ersteinrichtung"
fi
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

customers() { curl -fsS --cacert "$CA" -H "Authorization: Bearer $1" "$BASE/customers" | json 'JSON.stringify(v.items ?? v)'; }
healthy() {
  for _ in $(seq 1 90); do curl -fsS --cacert "$CA" -o /dev/null "$BASE/health" 2>/dev/null && return 0; sleep 2; done
  return 1
}
still_there() {
  healthy || fail "$1: GartenAI antwortet nicht"
  TOKEN=$(login) || fail "$1: Anmeldung"
  grep -q 'Familie Sicher' <<<"$(customers "$TOKEN")" || fail "$1: Daten fehlen"
  [ "$(curl -fsS --cacert "$CA" "$BASE/setup/status" | json 'v.needed')" = false ] || fail "$1: fragt wieder nach der Einrichtung"
}

# E5: beenden und wieder starten
ops/buero/stop.sh
ops/buero/start.sh
still_there "Beenden und Starten"
echo "✓ Beenden und Starten, Daten unverändert"

# E4: Rechner neu gestartet – Docker startet neu, GartenAI kommt ohne Zutun wieder
# (mit Podman übernimmt das Podman Desktop bzw. podman-restart.service, nicht geprüft)
if [[ "${DOCKER_HOST:-}" == *podman* ]]; then
  echo "(Neustart der Container-Umgebung mit Podman nicht geprüft)"
elif [ -n "${CI:-}" ] && command -v systemctl >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo systemctl restart docker
  still_there "Neustart von Docker"
  echo "✓ nach dem Neustart von Docker ohne Zutun erreichbar"
fi

# E6: Update – sichert zuerst, holt die neue Version (hier: keine neuere) und startet
if [ -n "${CI:-}" ]; then
  # update.sh braucht einen Zweig mit Upstream; die CI hat nur einen losgelösten Stand
  UPSTREAM=$(mktemp -d)/upstream.git
  git checkout -q -B buero-update-test
  git clone -q --bare . "$UPSTREAM"
  git remote add buero-upstream "$UPSTREAM"
  git fetch -q buero-upstream
  git branch -q -u buero-upstream/buero-update-test
fi
count() { find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.tmp' | wc -l; }
before=$(count)
sleep 1 # neue Sicherung bekommt einen neuen Zeitstempel
if [ -n "${CI:-}" ] || git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  ops/buero/update.sh
  [ "$(count)" -gt "$before" ] || fail "Update hat vorher nicht gesichert"
  still_there "Update"
  echo "✓ Update: erst gesichert, danach mit allen Daten wieder da"
fi

# dasselbe mit dem Windows-Skript (restore.cmd → restore.ps1), wenn PowerShell da ist
if command -v pwsh >/dev/null 2>&1; then
  curl -fsS --cacert "$CA" -X POST "$BASE/customers" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"Nach der Sicherung (Windows)"}' >/dev/null
  pwsh -NoProfile -File ops/buero/restore.ps1 -Dir "$LATEST" -Yes
  for _ in $(seq 1 60); do curl -fsS --cacert "$CA" -o /dev/null "$BASE/health" 2>/dev/null && break; sleep 2; done
  TOKEN=$(login) || fail "Anmeldung nach dem Zurückspielen (Windows-Skript)"
  names=$(curl -fsS --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$BASE/customers" | json 'JSON.stringify(v.items ?? v)')
  grep -q 'Familie Sicher' <<<"$names" || fail "Kunde aus der Sicherung fehlt (Windows-Skript): $names"
  if grep -q 'Windows' <<<"$names"; then fail "restore.ps1 hat nichts ersetzt"; fi
  echo "✓ Zurückspielen mit restore.ps1"
fi
# Verschlüsselt gespeicherte Schlüssel (SECRET_KEY aus .env.buero): KI-Anbieter
# mit API-Schlüssel und Push-Schlüssel – bis 09/2026 lehnte das Backend die
# 48 Zeichen aus start.sh als SECRET_KEY ab
AUTH="Authorization: Bearer $TOKEN"
status=$(curl -sS --cacert "$CA" -o /dev/null -w '%{http_code}' -X POST "$BASE/ai/providers" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"name":"KI im Büro","kind":"openai_compatible","baseUrl":"http://host.docker.internal:11434/v1","model":"llama3","apiKey":"sk-buero-123"}')
[ "$status" = 201 ] || fail "KI-Anbieter mit API-Schlüssel speichern: HTTP $status"
PUSH_KEY=$(curl -fsS --cacert "$CA" -H "$AUTH" "$BASE/push/public-key" | json 'v.publicKey') || fail "Push-Schlüssel"
DOC=$(curl -fsS --cacert "$CA" -X POST "$BASE/documents/upload?documentType=delivery_note" -H "$AUTH" \
  -F "file=@ops/fixtures/smoke-scan.png;type=image/png" | json 'v.id')
echo "✓ verschlüsselte Schlüssel (KI-Anbieter, Push) und Dokument im Büro"

# Umzug auf einen Server: Sicherung vom Büro-Rechner in den Server-Stack
sleep 1 # neue Sicherung bekommt einen neuen Zeitstempel
ops/buero/backup-now.sh
MOVE=$(find backups/buero -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.tmp' | sort | tail -n 1)
SERVER_BASE=http://localhost:8096/api
(
  # Server mit eigenen Passwörtern, nur SECRET_KEY kommt vom Büro-Rechner mit
  POSTGRES_PASSWORD="server$(date +%s)"
  SECRET_KEY=$(sed -n 's/^SECRET_KEY=//p' .env.buero)
  export POSTGRES_PASSWORD SECRET_KEY JWT_SECRET="umzug-test-jwt-secret-0123456789abcdef"
  export APP_PORT=8096 COOKIE_SECURE=0 COMPOSE_PROJECT_NAME=gartenai-umzug-test
  "${SERVER[@]}" up -d --build >/dev/null
  for _ in $(seq 1 90); do curl -fsS -o /dev/null "$SERVER_BASE/health" 2>/dev/null && break; sleep 2; done
  ENV_FILE=/dev/null COMPOSE_FILE=docker-compose.prod.yml ops/restore.sh "$MOVE" --yes
)
for _ in $(seq 1 90); do curl -fsS -o /dev/null "$SERVER_BASE/health" 2>/dev/null && break; sleep 2; done
SERVER_TOKEN=$(curl -fsS -X POST "$SERVER_BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"clara@gruen-stein.de","password":"ein-langes-passwort"}' | json 'v.accessToken') ||
  fail "Umzug: Anmeldung auf dem Server"
SAUTH="Authorization: Bearer $SERVER_TOKEN"
grep -q 'Familie Sicher' <<<"$(curl -fsS -H "$SAUTH" "$SERVER_BASE/customers" | json 'JSON.stringify(v.items ?? v)')" ||
  fail "Umzug: Kunden fehlen"
cmp -s <(curl -fsS -H "$SAUTH" "$SERVER_BASE/documents/$DOC/download") ops/fixtures/smoke-scan.png ||
  fail "Umzug: Dokument fehlt oder ist verändert"
[ "$(curl -fsS -H "$SAUTH" "$SERVER_BASE/push/public-key" | json 'v.publicKey')" = "$PUSH_KEY" ] ||
  fail "Umzug: Push-Schlüssel nicht lesbar (SECRET_KEY nicht übernommen?)"
[ "$(curl -fsS -H "$SAUTH" "$SERVER_BASE/ai/providers" | json 'v.find(p=>p.name==="KI im Büro")?.hasApiKey')" = true ] ||
  fail "Umzug: KI-Anbieter fehlt"
if [ -x frontend/node_modules/.bin/playwright ]; then
  curl -fsS -o /dev/null -X POST "$SERVER_BASE/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"mitarbeiter@gruen-stein.de","password":"startpasswort-123"}' || fail "Umzug: Zugang Mitarbeiter"
fi
echo "✓ Umzug auf den Server: Anmeldung, Kunden, Dokument, Push- und KI-Schlüssel"

echo "Rauchtest Büro bestanden."
