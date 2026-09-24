#!/usr/bin/env bash
# Test für ops/deploy.sh ohne echten Server: docker und curl sind Attrappen,
# git ist ein echtes Repository mit Tags. Prüft Ausrollen, Sicherung,
# Zurückfallen bei einer kaputten Version, --rollback und fehlende Images.
# Aufruf: bash ops/tests/deploy.test.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "✗ $*" >&2
  exit 1
}
ok() { echo "✓ $*"; }

# Attrappen: docker merkt sich die laufende Version, curl meldet sie zurück
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $* [GARTENAI_VERSION=${GARTENAI_VERSION:-}]" >>"$STUB_DIR/calls"
args=" $* "
case "$args" in
  *" pull "*) [ "${GARTENAI_VERSION}" = "${STUB_MISSING:-}" ] && exit 1; exit 0 ;;
  *" ps "*) [ -f "$STUB_DIR/running" ] && echo postgres; exit 0 ;;
  *" pg_dump "*) echo "DUMP ${GARTENAI_VERSION}"; exit 0 ;;
  *" tar "*) echo "TAR"; exit 0 ;;
  *" up "*) echo "${GARTENAI_VERSION}" >"$STUB_DIR/running"; exit 0 ;;
  *" logs "*) echo "backend | Fehler beim Start"; exit 0 ;;
esac
exit 0
EOF
cat >"$WORK/bin/curl" <<'EOF'
#!/usr/bin/env bash
running=$(cat "$STUB_DIR/running" 2>/dev/null || true)
[ -n "$running" ] && [ "$running" != "${STUB_BROKEN:-}" ] || exit 7
printf '{"status":"ok","version":"%s","timestamp":"x"}' "$running"
EOF
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH" STUB_DIR="$WORK/stub" GARTENAI_IMAGE=registry.example/gartenai HEALTH_TIMEOUT=1
mkdir -p "$STUB_DIR"

# Server-Checkout mit Versionen v1..v4 (über ein "origin")
git init --quiet --bare "$WORK/origin.git"
git init --quiet "$WORK/server"
cd "$WORK/server"
git config user.email test@example.com
git config user.name Test
mkdir -p ops
cp "$ROOT/ops/deploy.sh" ops/deploy.sh
echo "services: {}" >docker-compose.prod.yml
echo ".deploy/" >.gitignore
for v in v1 v2 v3 v4; do
  echo "$v" >VERSION
  git add -A
  git commit --quiet -m "$v"
  git tag "$v"
done
git remote add origin "$WORK/origin.git"
git push --quiet origin HEAD:refs/heads/main --tags 2>/dev/null
git checkout --quiet --detach v1
printf 'POSTGRES_PASSWORD=x\nJWT_SECRET=x\nAPP_PORT=8080\n' >.env.production

state() { cat ".deploy/$1" 2>/dev/null || true; }
running() { cat "$STUB_DIR/running" 2>/dev/null || true; }

bash ops/deploy.sh v1 >"$WORK/out1" 2>&1 || fail "v1 ausrollen: $(cat "$WORK/out1")"
if ! { [ "$(state current)" = v1 ] && [ "$(running)" = v1 ]; }; then fail "v1 läuft nicht"; fi
ok "erste Version ausgerollt"

bash ops/deploy.sh v2 >"$WORK/out2" 2>&1 || fail "v2 ausrollen: $(cat "$WORK/out2")"
if ! { [ "$(state current)" = v2 ] && [ "$(state previous)" = v1 ]; }; then fail "Stand nach v2 falsch"; fi
[ "$(cat VERSION)" = v2 ] || fail "Code von v2 nicht ausgecheckt"
ls .deploy/backups/*-v1.dump >/dev/null 2>&1 || fail "keine Datenbank-Sicherung vor v2"
ls .deploy/backups/*-v1-uploads.tgz >/dev/null 2>&1 || fail "keine Sicherung der Dokumente vor v2"
grep -q "pull --quiet backend frontend \[GARTENAI_VERSION=v2\]" "$STUB_DIR/calls" || fail "Images v2 nicht geladen"
ok "Update mit Sicherung von Datenbank und Dokumenten"

if STUB_BROKEN=v3 bash ops/deploy.sh v3 >"$WORK/out3" 2>&1; then fail "kaputte v3 als Erfolg gemeldet"; fi
if ! { [ "$(running)" = v2 ] && [ "$(state current)" = v2 ]; }; then fail "nicht auf v2 zurückgefallen"; fi
[ "$(cat VERSION)" = v2 ] || fail "Code nicht auf v2 zurück"
grep -q "pg_restore" "$WORK/out3" || fail "Hinweis zum Zurückspielen fehlt"
grep -q "Fehler beim Start" "$WORK/out3" || fail "Logs der kaputten Version fehlen"
ok "kaputte Version: zurück auf die vorige, mit Hinweis auf die Sicherung"

bash ops/deploy.sh --rollback >"$WORK/out4" 2>&1 || fail "Rollback: $(cat "$WORK/out4")"
if ! { [ "$(state current)" = v1 ] && [ "$(state previous)" = v2 ] && [ "$(running)" = v1 ]; }; then fail "Rollback auf v1 falsch"; fi
ok "--rollback auf die vorige Version"

if STUB_MISSING=v4 bash ops/deploy.sh v4 >"$WORK/out5" 2>&1; then fail "fehlende Images als Erfolg gemeldet"; fi
if ! { [ "$(running)" = v1 ] && [ "$(cat VERSION)" = v1 ]; }; then fail "bei fehlenden Images etwas geändert"; fi
grep -q "nichts geändert" "$WORK/out5" || fail "Meldung bei fehlenden Images fehlt"
ok "fehlende Images: nichts geändert"

if bash ops/deploy.sh v9 >"$WORK/out6" 2>&1; then fail "unbekannte Version als Erfolg gemeldet"; fi
grep -q "gibt es im Repository nicht" "$WORK/out6" || fail "Meldung bei unbekannter Version fehlt"
ok "unbekannte Version abgelehnt"

echo "Alle Prüfungen bestanden."
