#!/usr/bin/env bash
# Cloud-Sicherung einrichten (macOS/Linux): ops/buero/cloud-setup.sh
# 1. rclone fragt nach dem Speicher (Google Drive, OneDrive, Nextcloud/WebDAV,
#    S3 …) und öffnet für die Anmeldung beim Anbieter den Browser.
# 2. Darüber legt das Skript eine Verschlüsselung (rclone "crypt") mit einem
#    zufälligen Passwort an und trägt das Ziel in .env.buero ein.
# Danach startet ops/buero/start.sh die Cloud-Sicherung automatisch mit.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env.buero
CONF_DIR="$PWD/ops/buero/rclone"
RCLONE=(docker run --rm -it -v "$CONF_DIR:/config/rclone" --network host rclone/rclone:1)
fail() { echo "✗ $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || fail "Zuerst einmal ops/buero/start.sh ausführen."
mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"

echo "Schritt 1: Cloud-Speicher verbinden. Im Menü n (neu) wählen, einen Namen"
echo "vergeben (z.B. drive) und den Anbieter auswählen. Zum Schluss q (beenden)."
"${RCLONE[@]}" config

read -rp "Name des eben angelegten Speichers (z.B. drive): " remote
[ -n "$remote" ] || fail "Kein Name angegeben."
read -rp "Ordner im Speicher [GartenAI-Sicherung]: " folder
folder=${folder:-GartenAI-Sicherung}

password=$(head -c 2048 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c 1-40)
salt=$(head -c 2048 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c 1-40)
docker run --rm -v "$CONF_DIR:/config/rclone" rclone/rclone:1 config create gartenai-sicher crypt \
  remote="$remote:$folder" password="$password" password2="$salt" --obscure >/dev/null
chmod 600 "$CONF_DIR/rclone.conf"

# Ziel und Passwörter in .env.buero (Passwörter für die Wiederherstellung!)
sed -i.bak '/^CLOUD_REMOTE=/d;/^CLOUD_CRYPT_PASSWORD/d' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
{
  echo "# Cloud-Sicherung (ops/buero/cloud-setup.sh) – ohne diese Passwörter lassen sich"
  echo "# die Sicherungen in der Cloud NICHT wiederherstellen: getrennt aufbewahren!"
  echo "CLOUD_REMOTE=gartenai-sicher:"
  echo "CLOUD_CRYPT_PASSWORD=$password"
  echo "CLOUD_CRYPT_PASSWORD2=$salt"
} >>"$ENV_FILE"

echo "Teste die Verbindung …"
docker run --rm -v "$CONF_DIR:/config/rclone" rclone/rclone:1 mkdir gartenai-sicher: ||
  fail "Keine Verbindung zum Speicher – Einrichtung wiederholen."
echo "✓ Cloud-Sicherung eingerichtet: $remote:$folder (verschlüsselt)."
echo "  Bitte die Passwörter CLOUD_CRYPT_PASSWORD/…2 aus .env.buero zusätzlich sicher notieren."
echo "  Jetzt ops/buero/start.sh ausführen – die Sicherungen werden stündlich hochgeladen."
