#!/bin/sh
# Eigene Demo-Zertifizierungsstelle und Server-Zertifikat für die Adressen im
# LAN. Läuft im Container (alpine), damit auf Windows, macOS und Linux kein
# openssl nötig ist:  sh make-certs.sh 192.168.1.20 [weitere Adressen …]
# Die Zertifizierungsstelle bleibt beim erneuten Aufruf erhalten – ein einmal
# auf dem Handy installiertes Stammzertifikat gilt weiter. CA_NAME: Name der
# Zertifizierungsstelle (Standard „GartenAI Demo CA“).
# Die Zertifizierungsstelle gilt 10 Jahre; läuft sie in weniger als 800 Tagen ab
# (ältere Installationen: 825 Tage), wird sie beim nächsten Server-Zertifikat
# erneuert – das Stammzertifikat muss dann auf den Handys neu installiert werden.
set -eu
cd "${CERT_DIR:-/certs}"
command -v openssl >/dev/null 2>&1 || apk add --no-cache openssl >/dev/null
if [ -f ca.crt ] && ! openssl x509 -checkend $((800 * 86400)) -noout -in ca.crt >/dev/null 2>&1; then
  echo "NEUE Zertifizierungsstelle (die alte läuft bald ab): Stammzertifikat auf den Handys neu installieren."
  rm -f ca.key ca.crt ca.srl
fi
if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout ca.key -out ca.crt \
    -subj "/CN=${CA_NAME:-GartenAI Demo CA}" -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
fi
san="DNS:localhost,IP:127.0.0.1"
for ip in "$@"; do san="$san,IP:$ip"; done
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=GartenAI Demo" 2>/dev/null
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$san" > server.ext
# höchstens 825 Tage: länger gültige Zertifikate lehnen iOS und macOS ab
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 \
  -extfile server.ext -out server.crt 2>/dev/null
rm -f server.csr server.ext
chmod 644 server.key server.crt ca.crt
echo "$*" > ips
echo "Zertifikat für: $san"
