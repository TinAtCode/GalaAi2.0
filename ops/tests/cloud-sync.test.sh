#!/usr/bin/env bash
# Test der Cloud-Sicherung (ops/buero/cloud-sync.sh) mit echtem rclone: ein
# lokaler Ordner spielt den Cloud-Speicher, darüber die Verschlüsselung wie in
# ops/buero/cloud-setup.sh. Geprüft: Hochladen, keine lesbaren Namen oder
# Inhalte beim "Anbieter", Aufräumen alter Stände, Zurückholen Byte für Byte.
set -euo pipefail
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'docker run --rm -v "$work:/w" alpine:3.20 rm -rf /w/backups /w/cloud /w/conf /w/restore >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
mkdir -p "$work/backups/20260101-020000" "$work/backups/20260102-020000" "$work/cloud" "$work/conf" "$work/restore"
echo "geheime Kundendaten Familie Müller" >"$work/backups/20260101-020000/gartenai.dump"
head -c 200000 /dev/urandom >"$work/backups/20260102-020000/uploads.tgz"
RCLONE=(docker run --rm -v "$work/conf:/config/rclone" -v "$work/cloud:/cloud" -v "$work/backups:/backups:ro"
  -v "$work/restore:/restore" -v "$PWD/ops/buero/cloud-sync.sh:/cloud-sync.sh:ro" -e CLOUD_REMOTE=gartenai-sicher:)
fail() { echo "✗ $*" >&2; exit 1; }

"${RCLONE[@]}" rclone/rclone:1 config create cloud local >/dev/null
"${RCLONE[@]}" rclone/rclone:1 config create gartenai-sicher crypt remote=cloud:/cloud/GartenAI \
  password=testpasswort1234567890 password2=testsalz1234567890 --obscure >/dev/null

"${RCLONE[@]}" --entrypoint sh rclone/rclone:1 /cloud-sync.sh now
files=$(find "$work/cloud" -type f | wc -l)
[ "$files" -eq 2 ] || fail "erwartet 2 Dateien in der Cloud, gefunden $files"
if grep -rq "Familie Müller" "$work/cloud"; then fail "Inhalt in der Cloud lesbar"; fi
if find "$work/cloud" | grep -q "gartenai.dump\|20260101"; then fail "Namen in der Cloud lesbar"; fi
echo "✓ verschlüsselt hochgeladen ($files Dateien, keine lesbaren Namen oder Inhalte)"

# lokal aufgeräumter Stand verschwindet auch in der Cloud; halbfertige (*.tmp) bleiben lokal
docker run --rm -v "$work:/w" alpine:3.20 sh -c 'rm -rf /w/backups/20260101-020000 && mkdir -p /w/backups/20260103-020000.tmp && echo x > /w/backups/20260103-020000.tmp/teil'
"${RCLONE[@]}" --entrypoint sh rclone/rclone:1 /cloud-sync.sh now
files=$(find "$work/cloud" -type f | wc -l)
[ "$files" -eq 1 ] || fail "nach dem Aufräumen erwartet 1 Datei, gefunden $files"
echo "✓ Aufräumen gespiegelt, halbfertige Sicherung nicht hochgeladen"

"${RCLONE[@]}" rclone/rclone:1 copy gartenai-sicher: /restore
cmp "$work/backups/20260102-020000/uploads.tgz" "$work/restore/20260102-020000/uploads.tgz" ||
  fail "zurückgeholte Sicherung weicht ab"
echo "✓ Sicherung aus der Cloud zurückgeholt (Byte für Byte gleich)"
