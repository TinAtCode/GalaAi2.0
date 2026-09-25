#!/usr/bin/env bash
# GartenAI im Büro starten (macOS/Linux): ops/buero/start.sh [--demo-daten]
#   --demo-daten   Musterbetrieb und Demo-Agent zum Ausprobieren laden
#                  (nur in eine leere Installation; Anmeldung demo12345)
# Beim ersten Start: Geheimnisse in .env.buero, eigene Zertifizierungsstelle,
# Ersteinrichtung im Browser mit dem angezeigten Einrichtungscode.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env.buero
COMPOSE=(docker compose -f docker-compose.buero.yml --env-file "$ENV_FILE")
DEMO=0
for arg in "$@"; do
  case "$arg" in
    --demo-daten) DEMO=1 ;;
    *) echo "Unbekannte Option: $arg (erlaubt: --demo-daten)" >&2; exit 2 ;;
  esac
done

fail() { echo "✗ $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "Docker fehlt – bitte Docker Desktop installieren und starten."
docker info >/dev/null 2>&1 || fail "Docker läuft nicht – bitte Docker Desktop starten."

# Geheimnisse je Installation, einmal erzeugt und danach nie geändert
# (head zuerst: tr liest bis zum Ende, kein SIGPIPE unter pipefail)
random() { head -c 2048 /dev/urandom | LC_ALL=C tr -dc "$1" | cut -c "1-$2"; }
secret() { random 'A-Za-z0-9' "$1"; }
if [ ! -f "$ENV_FILE" ]; then
  code=$(random 'A-HJ-NP-Z2-9' 8)
  umask 077
  cat >"$ENV_FILE" <<ENV
# GartenAI im Büro – Geheimnisse dieser Installation. Nicht weitergeben, nicht
# ändern (sonst passen Datenbank und gespeicherte Schlüssel nicht mehr).
# Zusammen mit den Sicherungen (backups/buero) aufbewahren.
POSTGRES_PASSWORD=$(secret 32)
JWT_SECRET=$(secret 48)
SECRET_KEY=$(secret 48)
SETUP_CODE=${code:0:4}-${code:4:4}
HTTPS_PORT=8443
# Mails verschicken, z.B. SMTP_URL=smtps://benutzer:passwort@mail.example.de:465
SMTP_URL=
MAIL_FROM=
BACKUP_KEEP=14
ENV
  echo "✓ Geheimnisse erzeugt ($ENV_FILE)"
fi
PORT=$(sed -n 's/^HTTPS_PORT=//p' "$ENV_FILE" | tail -n 1)
PORT=${PORT:-8443}

# Adressen dieses Rechners im LAN/WLAN (ohne Docker-Netze und localhost)
lan_ips() {
  {
    if command -v ipconfig >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then
      for dev in en0 en1 en2; do ipconfig getifaddr "$dev" 2>/dev/null || true; done
    else
      ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'
      hostname -I 2>/dev/null | tr ' ' '\n'
    fi
    # Tailscale (Zugriff von unterwegs, siehe BUERO.md)
    if command -v tailscale >/dev/null 2>&1; then tailscale ip -4 2>/dev/null || true; fi
  } | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^(127\.|172\.(1[7-9]|2[0-9]|3[01])\.|169\.254\.)' | awk '!seen[$0]++'
}
IPS=()
while IFS= read -r ip; do IPS+=("$ip"); done < <(lan_ips)

mkdir -p ops/buero/certs backups/buero
if [ ! -f ops/buero/certs/server.crt ] || [ "$(cat ops/buero/certs/ips 2>/dev/null)" != "${IPS[*]:-}" ]; then
  echo "Erzeuge Zertifikate …"
  docker run --rm -e CA_NAME="GartenAI Buero CA" -v "$PWD/ops/demo:/demo:ro" -v "$PWD/ops/buero/certs:/certs" \
    alpine:3.20 sh /demo/make-certs.sh ${IPS[@]+"${IPS[@]}"}
fi

[ "$DEMO" = 1 ] && COMPOSE+=(--profile demo)
# Cloud-Sicherung und Tunnel laufen mit, sobald sie eingerichtet sind
setting() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
[ -n "$(setting CLOUD_REMOTE)" ] && COMPOSE+=(--profile cloud)
[ -n "$(setting CLOUDFLARE_TUNNEL_TOKEN)" ] && COMPOSE+=(--profile tunnel)
echo "Starte GartenAI (beim ersten Mal werden die Images gebaut, das dauert einige Minuten) …"
"${COMPOSE[@]}" up -d --build

MAIN="https://localhost:$PORT"
CA=ops/buero/certs/ca.crt
for _ in $(seq 1 120); do
  curl -fsS --cacert "$CA" -o /dev/null "$MAIN/api/health" 2>/dev/null && break
  sleep 2
done
curl -fsS --cacert "$CA" -o /dev/null "$MAIN/api/health" || fail "GartenAI antwortet nicht. Logs: docker compose -f docker-compose.buero.yml logs backend"

if [ "$DEMO" = 1 ]; then
  echo "Lade die Demo-Daten …"
  for _ in $(seq 1 180); do
    state=$("${COMPOSE[@]}" ps -a --format '{{.State}} {{.ExitCode}}' demo-data 2>/dev/null || true)
    case "$state" in
      "exited 0") break ;;
      exited*) "${COMPOSE[@]}" logs demo-data | tail -20; fail "Demo-Daten fehlgeschlagen (siehe oben)." ;;
    esac
    sleep 2
  done
fi

echo
echo "✓ GartenAI läuft"
echo "  Auf diesem Rechner: $MAIN"
for ip in ${IPS[@]+"${IPS[@]}"}; do echo "  Im Netz (Handy):    https://$ip:$PORT"; done
status=$(curl -fsS --cacert "$CA" "$MAIN/api/setup/status" || true)
if [[ "$status" == *'"needed":true'* ]]; then
  echo
  echo "  Ersteinrichtung: im Browser öffnen und Firma und Zugang anlegen."
  echo "  Einrichtungscode: $(sed -n 's/^SETUP_CODE=//p' "$ENV_FILE")"
fi
[ "$DEMO" = 1 ] && echo "  Demo-Zugänge: admin@musterbetrieb.de, buero@…, mitarbeiter@… (Passwort demo12345)"
echo "  Browser und Handy: einmal das Stammzertifikat installieren: $MAIN/demo-ca.crt (siehe BUERO.md)"
echo "  Sicherungen: täglich automatisch in backups/buero · Beenden: ops/buero/stop.sh"
if [ "${#IPS[@]}" -gt 0 ] && command -v qrencode >/dev/null 2>&1; then qrencode -t ansiutf8 "https://${IPS[0]}:$PORT"; fi
