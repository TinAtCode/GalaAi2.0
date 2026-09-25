#!/usr/bin/env bash
# Server-Probe: der ganze Weg auf einen Server, ohne Attrappen. Die Maschine,
# auf der der Test läuft (in der CI eine frische Ubuntu-VM), spielt den Server:
#
#   - Code: ein Git-Repository als „origin“ mit den Versionen v1, v2, v3,
#     auf dem Server ein Checkout davon (wie in BETRIEB.md)
#   - Images: eigene Registry (statt ghcr.io); v3 ist absichtlich kaputt
#   - Zugang: echtes SSH mit Schlüssel und festem Fingerabdruck, derselbe
#     Befehl wie in .github/workflows/deploy.yml (ohne docker login)
#   - HTTPS: Caddy davor mit eigener Zertifizierungsstelle
#
# Geprüft: Ausrollen v1, Einrichtung, Anmeldung über HTTPS (Secure-Cookie),
# Daten und Dokument; Update auf v2 mit Sicherung; kaputte v3 → automatisch
# zurück auf v2; --rollback → v1. Die Daten bleiben die ganze Zeit erhalten.
#
# Verändert ~/.ssh/authorized_keys und startet sshd – deshalb nur mit
# SERVER_PROBE=1 (in der CI gesetzt):  SERVER_PROBE=1 bash ops/tests/server-probe.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "${SERVER_PROBE:-}" = 1 ] || {
  echo "Nur mit SERVER_PROBE=1 (richtet sshd und einen SSH-Schlüssel ein – für CI-Maschinen gedacht)." >&2
  exit 1
}
REPO=$PWD
WORK=$(mktemp -d)
SERVER=$WORK/server/gartenai
IMAGE=localhost:5000/gala
DOMAIN=gala.localhost
BASE=https://$DOMAIN:8443
CA=$WORK/ca.crt
KEY=$WORK/deploy_key

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() {
  echo "✗ $*" >&2
  exit 1
}
compose() {
  (cd "$SERVER" && GARTENAI_IMAGE=$IMAGE GARTENAI_VERSION=${VERSION:-v1} docker compose -f docker-compose.prod.yml --env-file .env.production "$@")
}
cleanup() {
  if [ "${1:-0}" != 0 ]; then
    compose logs --no-color --tail=120 || true
    docker logs --tail=40 gala-caddy || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f gala-registry gala-caddy >/dev/null 2>&1 || true
  if [ -f "$KEY.pub" ] && [ -f ~/.ssh/authorized_keys ]; then
    grep -vF "$(cat "$KEY.pub")" ~/.ssh/authorized_keys >"$WORK/ak" || true
    cat "$WORK/ak" >~/.ssh/authorized_keys
  fi
  rm -rf "$WORK"
}
trap 'cleanup $?' EXIT
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }
https() { curl -fsS --cacert "$CA" --resolve "$DOMAIN:8443:127.0.0.1" "$@"; }
version() { https "$BASE/api/health" | json 'v.version'; }

# ── Code: origin mit v1, v2, v3 (derselbe Stand; die Versionen unterscheiden
#    sich in den Images) ─────────────────────────────────────────────────────
log "Richte den Server ein"
mkdir -p "$WORK/src"
git -C "$REPO" archive HEAD | tar -x -C "$WORK/src"
git -C "$WORK/src" init -q -b main
git -C "$WORK/src" -c user.name=Probe -c user.email=probe@localhost add -A
git -C "$WORK/src" -c user.name=Probe -c user.email=probe@localhost commit -qm "Stand für die Server-Probe"
for v in v1 v2 v3; do git -C "$WORK/src" tag "$v"; done
git clone -q --bare "$WORK/src" "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$SERVER"

# Geheimnisse wie in BETRIEB.md (openssl rand -hex 32); HTTPS-Proxy davor
cp "$SERVER/.env.production.example" "$SERVER/.env.production"
setenv() { sed -i "s|^$1=.*|$1=$2|" "$SERVER/.env.production"; }
setenv POSTGRES_PASSWORD "$(openssl rand -hex 32)"
setenv JWT_SECRET "$(openssl rand -hex 32)"
setenv SECRET_KEY "$(openssl rand -hex 32)"
setenv TRUST_PROXY 2
setenv APP_PORT 8080

# ── Images in der eigenen Registry ────────────────────────────────────────
log "Baue die Images und lege sie in die Registry"
docker run -d --name gala-registry -p 5000:5000 registry:2 >/dev/null
docker build -q -t "$IMAGE-backend:v1" "$SERVER/backend" >/dev/null
docker build -q -t "$IMAGE-frontend:v1" "$SERVER/frontend" >/dev/null
for part in backend frontend; do
  docker tag "$IMAGE-$part:v1" "$IMAGE-$part:v2"
  docker tag "$IMAGE-$part:v1" "$IMAGE-$part:v3"
done
# v3: Backend startet nicht (wie eine fehlerhafte Version)
printf 'FROM %s\nCMD ["node", "-e", "console.error(\\"kaputt\\"); process.exit(1)"]\n' "$IMAGE-backend:v1" |
  docker build -q -t "$IMAGE-backend:v3" - >/dev/null
for v in v1 v2 v3; do
  for part in backend frontend; do docker push -q "$IMAGE-$part:$v" >/dev/null; done
done
# lokal entfernen: der Server muss die Images wirklich aus der Registry holen
for v in v1 v2 v3; do docker image rm "$IMAGE-backend:$v" "$IMAGE-frontend:$v" >/dev/null; done
echo "✓ Images v1–v3 in der Registry, Code mit Versionen in origin"

# ── SSH wie beim echten Server ─────────────────────────────────────────────
if [ ! -x /usr/sbin/sshd ]; then
  sudo apt-get update -qq && sudo apt-get install -y -qq openssh-server >/dev/null
fi
# Runner-Images bringen keine Host-Schlüssel mit – ohne sie startet sshd nicht
sudo ssh-keygen -A >/dev/null
sudo mkdir -p /run/sshd
sudo systemctl restart ssh 2>/dev/null || sudo /usr/sbin/sshd
ssh-keygen -q -t ed25519 -N '' -f "$KEY"
install -m 700 -d ~/.ssh
cat "$KEY.pub" >>~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
for _ in $(seq 1 20); do ssh-keyscan -q -p 22 localhost >"$WORK/known_hosts" 2>/dev/null && [ -s "$WORK/known_hosts" ] && break; sleep 1; done
if [ ! -s "$WORK/known_hosts" ]; then
  sudo /usr/sbin/sshd -t || true
  sudo systemctl status ssh --no-pager 2>&1 | tail -n 20 || true
  fail "sshd antwortet nicht"
fi
deploy() {
  ssh -i "$KEY" -o BatchMode=yes -o UserKnownHostsFile="$WORK/known_hosts" "$(id -un)@localhost" \
    "cd '$SERVER' && GARTENAI_IMAGE='$IMAGE' HEALTH_TIMEOUT=90 ops/deploy.sh $1"
}

# ── HTTPS davor (Caddy, eigene Zertifizierungsstelle) ──────────────────────
docker run -d --name gala-caddy --network host caddy:2 \
  caddy reverse-proxy --from "$DOMAIN:8443" --to localhost:8080 --internal-certs >/dev/null
for _ in $(seq 1 30); do
  docker exec gala-caddy cat /data/caddy/pki/authorities/local/root.crt >"$CA" 2>/dev/null && [ -s "$CA" ] && break
  sleep 1
done
[ -s "$CA" ] || fail "Caddy hat keine Zertifizierungsstelle angelegt"

# ── v1 ausrollen, einrichten, Daten anlegen ────────────────────────────────
log "Rolle v1 per SSH aus"
deploy v1
[ "$(version)" = v1 ] || fail "v1 antwortet nicht über HTTPS"
echo "✓ v1 per SSH ausgerollt, über HTTPS erreichbar"

VERSION=v1 compose exec -T \
  -e SETUP_COMPANY_NAME="Probe GaLaBau GmbH" \
  -e SETUP_ADMIN_EMAIL="chef@probe.de" \
  -e SETUP_ADMIN_PASSWORD="probe-passwort-123" \
  -e SETUP_ADMIN_FIRST_NAME="Paula" \
  -e SETUP_ADMIN_LAST_NAME="Probe" \
  backend node dist/cli/setup-company.js >/dev/null
LOGIN=$(https -D "$WORK/headers" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -H 'X-Requested-With: fetch' -d '{"email":"chef@probe.de","password":"probe-passwort-123"}')
grep -i '^set-cookie: gartenai_session=' "$WORK/headers" | grep -qi 'secure' || fail "Sitzungs-Cookie ohne Secure"
TOKEN=$(json 'v.accessToken' <<<"$LOGIN")
AUTH="Authorization: Bearer $TOKEN"
https -X POST "$BASE/api/customers" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Familie Probe"}' >/dev/null
DOC=$(https -X POST "$BASE/api/documents/upload" -H "$AUTH" \
  -F "file=@$REPO/ops/fixtures/smoke-scan.png;type=image/png" | json 'v.id')
echo "✓ Einrichtung, Anmeldung über HTTPS mit Secure-Cookie, Kunde und Dokument angelegt"

# mit dem Token von vorhin: Sitzungen überstehen Updates und Neustarts
data_intact() {
  https "$BASE/api/customers" -H "Authorization: Bearer $TOKEN" | grep -q 'Familie Probe' || return 1
  https "$BASE/api/documents/$DOC/download" -H "Authorization: Bearer $TOKEN" -o "$WORK/doc.png" || return 1
  cmp -s "$WORK/doc.png" "$REPO/ops/fixtures/smoke-scan.png"
}

# ── Update auf v2: mit Sicherung vorher ────────────────────────────────────
log "Rolle v2 aus"
deploy v2
[ "$(version)" = v2 ] || fail "v2 antwortet nicht"
data_intact || fail "Daten nach dem Update auf v2 nicht vollständig"
ls "$SERVER"/.deploy/backups/*-v1.dump >/dev/null 2>&1 || fail "keine Sicherung vor dem Update"
[ -n "$(find "$SERVER/.deploy/backups" -name '*-v1-uploads.tgz' -size +0 -print -quit)" ] || fail "Dokumente nicht gesichert"
echo "✓ Update auf v2: vorher gesichert (Datenbank und Dokumente), Daten erhalten"

# ── kaputte v3: muss scheitern und v2 wieder starten ───────────────────────
log "Rolle die kaputte v3 aus (soll scheitern)"
if deploy v3; then fail "kaputte v3 wurde als erfolgreich gemeldet"; fi
[ "$(version)" = v2 ] || fail "nach dem Fehlschlag läuft nicht wieder v2"
[ "$(cat "$SERVER/.deploy/current")" = v2 ] || fail ".deploy/current zeigt nicht v2"
data_intact || fail "Daten nach dem Fehlschlag nicht vollständig"
echo "✓ kaputte v3 erkannt, automatisch zurück auf v2, Daten erhalten"

# ── Rückkehr per --rollback ────────────────────────────────────────────────
log "Zurück auf die vorige Version (--rollback)"
deploy --rollback
[ "$(version)" = v1 ] || fail "--rollback hat nicht v1 gestartet"
data_intact || fail "Daten nach --rollback nicht vollständig"
echo "✓ --rollback auf v1, Daten erhalten"
echo "Server-Probe bestanden."
