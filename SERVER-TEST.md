# Server zum Anfassen – virtuelle Maschine auf dem eigenen Rechner

So lässt sich die Server-Version (`BETRIEB.md`) ausprobieren, ohne einen Server zu mieten: Eine
virtuelle Maschine (VM) mit Ubuntu verhält sich wie ein gemieteter Linux-Server. Nach dem Test wird
sie mit einem Befehl gelöscht. Der automatische Weg (Ausrollen per SSH, Update, Rückfall) läuft
zusätzlich bei jedem Push in der CI (`ops/tests/server-probe.sh`).

Dauer: etwa 30 Minuten, davon 10 Minuten Warten beim ersten Bauen. Der Rechner braucht rund 4 GB
freien Arbeitsspeicher und 20 GB Platz.

## 1. Multipass installieren und die VM anlegen

| System | Installation |
|---|---|
| Windows | `winget install Canonical.Multipass` (braucht Windows 10/11 Pro mit Hyper-V oder VirtualBox) |
| macOS | `brew install --cask multipass` |
| Linux | `sudo snap install multipass` |

```
multipass launch 24.04 --name gala-server --cpus 2 --memory 4G --disk 20G
multipass shell gala-server
```

Ab hier läuft alles **in der VM** (Eingabeaufforderung `ubuntu@gala-server`).

## 2. Docker und GartenAI auf den „Server“

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Erneut `multipass shell gala-server`, dann:

```bash
git clone https://github.com/TinAtCode/GalaAi2.0.git gartenai
cd gartenai
```

Ist das Repository privat, fragt `git` nach Benutzer und Passwort. Als Passwort dann ein
GitHub-Token (Settings → Developer settings → Personal access tokens) nehmen. Oder auf dem eigenen
Rechner das ZIP von GitHub laden und mit `multipass transfer GalaAi2.0-main.zip gala-server:` in
die VM kopieren, dort `sudo apt-get install -y unzip && unzip GalaAi2.0-main.zip`.

## 3. Einstellungen und Start

```bash
cp .env.production.example .env.production
for key in POSTGRES_PASSWORD JWT_SECRET SECRET_KEY; do
  sed -i "s|^$key=.*|$key=$(openssl rand -hex 32)|" .env.production
done
# Kurztest ohne HTTPS: direkt auf Port 8080, kein Proxy davor
sed -i 's|^TRUST_PROXY=.*|TRUST_PROXY=1|; s|^COOKIE_SECURE=.*|COOKIE_SECURE=0|' .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Das erste Bauen dauert 5–10 Minuten. Fertig ist es, wenn `curl http://localhost:8080/api/health`
`"status":"ok"` meldet. Dann die Firma und den ersten Zugang anlegen:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec \
  -e SETUP_COMPANY_NAME="Musterbetrieb GaLaBau" \
  -e SETUP_ADMIN_EMAIL="chef@musterbetrieb.de" \
  -e SETUP_ADMIN_PASSWORD="mindestens-zehn-zeichen" \
  -e SETUP_ADMIN_FIRST_NAME="Max" -e SETUP_ADMIN_LAST_NAME="Muster" \
  backend node dist/cli/setup-company.js
```

## 4. Vom eigenen Rechner aus benutzen

Auf dem eigenen Rechner (nicht in der VM) zeigt `multipass info gala-server` die Adresse (IPv4),
z.B. `172.24.80.15`. Im Browser `http://172.24.80.15:8080` öffnen und anmelden.

**Handy:** Die VM ist normalerweise nur vom eigenen Rechner aus erreichbar. Fürs Handy die VM mit
einer Brücke ins WLAN anlegen: `multipass networks` zeigt die Netzwerkkarten, dann beim Anlegen
zusätzlich `--network <Name>` angeben. Die VM bekommt eine Adresse im WLAN.

## 5. Was testen

- **Bedienung:** wie in `BUERO-TEST.md`, Teile B bis D (Team, kompletter Auftrag, Rechnungen …).
- **Sichern und Zurückspielen** (wie auf dem echten Server):
  ```bash
  ops/backup.sh                          # nach backups/<Datum-Uhrzeit>/
  # einen Testkunden anlegen, dann:
  ops/restore.sh backups/<Datum-Uhrzeit>  # Testkunde ist danach weg
  ```
- **Update:** `ops/backup.sh`, dann `git pull` und
  `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
  Daten und Anmeldung bleiben erhalten.
- **Neustart des Servers:** auf dem eigenen Rechner `multipass restart gala-server`. GartenAI
  läuft danach von selbst wieder.
- **Optional HTTPS wie im Betrieb** (Caddy mit eigener Zertifizierungsstelle, in der VM):
  ```bash
  IP=$(hostname -I | cut -d' ' -f1)
  sed -i 's|^TRUST_PROXY=.*|TRUST_PROXY=2|; s|^COOKIE_SECURE=.*|COOKIE_SECURE=|' .env.production
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d
  docker run -d --name caddy --restart unless-stopped --network host caddy:2 \
    caddy reverse-proxy --from "https://$IP:8443" --to localhost:8080 --internal-certs
  docker exec caddy cat /data/caddy/pki/authorities/local/root.crt > gala-ca.crt
  ```
  `gala-ca.crt` mit `multipass transfer gala-server:gartenai/gala-ca.crt .` auf den eigenen
  Rechner holen und als vertrauenswürdige Stammzertifizierungsstelle installieren (Schritte wie in
  `DEMO.md`). Dann `https://<IP>:8443` öffnen.

## 6. Aufräumen

```
multipass delete --purge gala-server
```

Rückmeldung am besten wie bei `BUERO-TEST.md`: was lief, was anders war, dazu bei Fehlern
`docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=200 backend`.
