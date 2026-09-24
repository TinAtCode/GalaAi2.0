#!/usr/bin/env bash
# Rauchtest für die Demo (docker-compose.demo.yml) mit HTTPS: startet sie über
# ops/demo/start.sh wie auf einem Laptop und prüft von außen: Zertifikat der
# Demo-CA gilt, Stammzertifikat zum Download, Demo-Infos mit Adresse im LAN,
# alle drei Zugänge, Mitarbeiter mit Terminen, Beispieldaten nur einmal.
# Aufruf im Projektordner: bash ops/tests/demo-smoke.sh  (räumt am Ende auf)
set -euo pipefail
cd "$(dirname "$0")/../.."
export DEMO_PORT=8090 DEMO_HTTPS_PORT=8453
COMPOSE=(docker compose -f docker-compose.demo.yml --profile https)
cleanup() {
  if [ "${1:-0}" != 0 ]; then "${COMPOSE[@]}" logs --no-color --tail=150 || true; fi
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf ops/demo/certs
}
trap 'cleanup $?' EXIT
fail() {
  echo "✗ $*" >&2
  exit 1
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }

ops/demo/start.sh --https
CA=ops/demo/certs/ca.crt
IP=$(cut -d' ' -f1 < ops/demo/certs/ips)
[ -n "$IP" ] || fail "keine Adresse im LAN erkannt"

curl -fsS --retry 15 --retry-all-errors --retry-delay 2 --cacert "$CA" -o /dev/null "https://localhost:$DEMO_HTTPS_PORT/" || fail "HTTPS mit Demo-CA (localhost)"
curl -fsS --cacert "$CA" -o /dev/null "https://$IP:$DEMO_HTTPS_PORT/" || fail "HTTPS mit Demo-CA ($IP)"
curl -fsS "http://$IP:$DEMO_PORT/" -o /dev/null || fail "http im LAN"
cmp -s <(curl -fsS --cacert "$CA" "https://$IP:$DEMO_HTTPS_PORT/demo-ca.crt") "$CA" || fail "Stammzertifikat zum Download"
echo "✓ HTTPS mit Demo-CA, Stammzertifikat zum Download"

BASE="https://$IP:$DEMO_HTTPS_PORT/api"
info=$(curl -fsS --cacert "$CA" "$BASE/demo/info")
[ "$(echo "$info" | json 'v.urls[0]')" = "https://$IP:$DEMO_HTTPS_PORT" ] || fail "Demo-Infos: $info"
echo "✓ Demo-Infos mit Adresse im LAN"

login() {
  curl -fsS --cacert "$CA" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"demo12345\"}" | json 'v.accessToken'
}
chef=$(login admin@musterbetrieb.de) || fail "Anmeldung Chef"
login buero@musterbetrieb.de >/dev/null || fail "Anmeldung Büro"
worker=$(login mitarbeiter@musterbetrieb.de) || fail "Anmeldung Mitarbeiter"
count=$(curl -fsS --cacert "$CA" -H "Authorization: Bearer $worker" "$BASE/site/today" | json 'v.appointments.length')
[ "$count" -ge 2 ] || fail "Mitarbeiter hat heute $count Termine"
echo "✓ drei Zugänge, Mitarbeiter mit $count Terminen heute"

# Demo-Agent als KI-Anbieter: Verbindungstest und Zeichnen im Lageplan
agent=$(curl -fsS --cacert "$CA" -H "Authorization: Bearer $chef" "$BASE/ai/providers" | json 'v[0].id')
tested=$(curl -fsS --cacert "$CA" -X POST -H "Authorization: Bearer $chef" -H 'X-Requested-With: fetch' \
  "$BASE/ai/providers/$agent/test")
[ "$(echo "$tested" | json 'v.ok')" = true ] || fail "Demo-Agent antwortet nicht: $tested"
drawn=$(curl -fsS --cacert "$CA" -X POST -H "Authorization: Bearer $chef" -H 'Content-Type: application/json' \
  -d '{"prompt":"Auftrag: Rasen 10 x 5 m","task":"lageplan_zeichnen"}' "$BASE/ai/gateway/complete" | json 'v.data.objects.length')
[ "$drawn" = 1 ] || fail "Demo-Agent zeichnet nicht"
echo "✓ Demo-Agent als KI-Anbieter"

# Ausgabe erst sammeln: grep -q würde compose sonst mit SIGPIPE beenden (pipefail)
second=$("${COMPOSE[@]}" run --rm -T demo-data 2>&1) || fail "zweiter Lauf der Beispieldaten: $second"
grep -q "schon da" <<<"$second" || fail "Beispieldaten beim zweiten Mal erneut angelegt: $second"
echo "✓ Beispieldaten nur einmal"
echo "Demo-Rauchtest bestanden."
