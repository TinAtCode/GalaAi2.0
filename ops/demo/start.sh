#!/usr/bin/env bash
# Demo starten (macOS/Linux): ops/demo/start.sh [--https]
#   --https   HTTPS mit eigener Demo-Zertifizierungsstelle: die App lässt sich
#             auf dem Handy installieren und läuft dort auch ohne Netz
# Braucht Docker (Docker Desktop oder Docker Engine mit Compose).
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f docker-compose.demo.yml)
PORT=${DEMO_PORT:-8080}
HTTPS_PORT=${DEMO_HTTPS_PORT:-8443}
HTTPS=0
for arg in "$@"; do
  case "$arg" in
    --https) HTTPS=1 ;;
    *) echo "Unbekannte Option: $arg (erlaubt: --https)" >&2; exit 2 ;;
  esac
done

fail() { echo "✗ $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "Docker fehlt – bitte Docker Desktop installieren und starten."
docker info >/dev/null 2>&1 || fail "Docker läuft nicht – bitte Docker Desktop starten."

# Adressen dieses Rechners im LAN/WLAN (ohne Docker-Netze und localhost)
lan_ips() {
  {
    if command -v ipconfig >/dev/null 2>&1 && [ "$(uname)" = Darwin ]; then
      for dev in en0 en1 en2; do ipconfig getifaddr "$dev" 2>/dev/null || true; done
    else
      ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'
      hostname -I 2>/dev/null | tr ' ' '\n'
    fi
  } | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^(127\.|172\.(1[7-9]|2[0-9]|3[01])\.|169\.254\.)' | awk '!seen[$0]++'
}
# ohne mapfile: macOS hat Bash 3.2
IPS=()
while IFS= read -r ip; do IPS+=("$ip"); done < <(lan_ips)
[ "${#IPS[@]}" -gt 0 ] || echo "Hinweis: keine Adresse im WLAN gefunden – die Demo läuft nur auf diesem Rechner."

URLS=()
for ip in ${IPS[@]+"${IPS[@]}"}; do
  if [ "$HTTPS" = 1 ]; then URLS+=("https://$ip:$HTTPS_PORT"); else URLS+=("http://$ip:$PORT"); fi
done
DEMO_URLS=$(IFS=,; echo "${URLS[*]:-}")
export DEMO_URLS

if [ "$HTTPS" = 1 ]; then
  mkdir -p ops/demo/certs
  if [ ! -f ops/demo/certs/server.crt ] || [ "$(cat ops/demo/certs/ips 2>/dev/null)" != "${IPS[*]:-}" ]; then
    echo "Erzeuge Demo-Zertifikate …"
    docker run --rm -v "$PWD/ops/demo:/demo:ro" -v "$PWD/ops/demo/certs:/certs" alpine:3.20 sh /demo/make-certs.sh ${IPS[@]+"${IPS[@]}"}
  fi
  COMPOSE+=(--profile https)
fi

echo "Starte die Demo (beim ersten Mal werden die Images gebaut, das dauert einige Minuten) …"
"${COMPOSE[@]}" up -d --build

echo "Warte auf die Beispieldaten …"
for _ in $(seq 1 180); do
  state=$("${COMPOSE[@]}" ps -a --format '{{.State}} {{.ExitCode}}' demo-data 2>/dev/null || true)
  case "$state" in
    "exited 0") break ;;
    exited*) "${COMPOSE[@]}" logs demo-data | tail -20; fail "Beispieldaten fehlgeschlagen (siehe oben). Neu anfangen: ops/demo/reset.sh" ;;
  esac
  sleep 2
done

MAIN="http://localhost:$PORT"
[ "$HTTPS" = 1 ] && MAIN="https://localhost:$HTTPS_PORT"
echo
echo "✓ GartenAI-Demo läuft"
echo "  Auf diesem Rechner: $MAIN"
for url in ${URLS[@]+"${URLS[@]}"}; do echo "  Im WLAN (Handy):   $url"; done
echo "  Anmeldungen (Passwort demo12345): admin@ (Chef), buero@ (Büro), mitarbeiter@musterbetrieb.de"
echo "  Die Anmeldeseite zeigt einen QR-Code für das Handy."
if [ "$HTTPS" = 1 ]; then
  echo "  Handy: zuerst ${URLS[0]:-$MAIN}/demo-ca.crt öffnen und das Zertifikat installieren (siehe DEMO.md)."
fi
if [ "${#URLS[@]}" -gt 0 ] && command -v qrencode >/dev/null 2>&1; then
  qrencode -t ansiutf8 "${URLS[0]}"
fi
echo "  Beenden: ops/demo/stop.sh · Zurücksetzen: ops/demo/reset.sh"
