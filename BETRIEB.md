# Betrieb auf einem eigenen Server

GartenAI läuft als drei Container: PostgreSQL, Backend (NestJS) und Frontend
(nginx). Von außen erreichbar ist nur das Frontend; nginx leitet `/api` an das
Backend weiter. Frontend und API haben so dieselbe Adresse, CORS ist nicht nötig.

Voraussetzungen: Docker mit Compose, 2 GB RAM (Texterkennung), ein Reverse-Proxy
mit HTTPS davor (z.B. Caddy, Traefik oder ein vorhandener nginx).

## Erster Start

```bash
cp .env.production.example .env.production
# POSTGRES_PASSWORD, JWT_SECRET und SECRET_KEY setzen mit: openssl rand -hex 32
# (Hex: das Passwort steht auch in der Datenbank-URL)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Beim Start wendet das Backend alle Datenbank-Migrationen an; schlägt das fehl,
startet es nicht. Stand prüfen: `curl http://localhost:8080/api/health`.

Danach die eigene Firma und den ersten Administrator anlegen (einmalig, ohne
Demo-Daten und ohne bekanntes Passwort):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec \
  -e SETUP_COMPANY_NAME="Musterbetrieb GaLaBau GmbH" \
  -e SETUP_ADMIN_EMAIL="chef@musterbetrieb.de" \
  -e SETUP_ADMIN_PASSWORD="mindestens-zehn-zeichen" \
  -e SETUP_ADMIN_FIRST_NAME="Max" \
  -e SETUP_ADMIN_LAST_NAME="Muster" \
  backend node dist/cli/setup-company.js
```

Der Administrator hat alle Rechte und legt weitere Nutzer in der Oberfläche an
(Einstellungen → Benutzer). Den Seed (`npx prisma db seed`) nur für Test- und
Demo-Umgebungen verwenden: Er legt eine Demo-Firma mit bekanntem Passwort an.

## HTTPS

Das Sitzungs-Cookie ist im Betrieb `Secure` und wird nur über HTTPS gesendet.
Beispiel mit Caddy (holt das Zertifikat selbst):

```
app.musterbetrieb.de {
  reverse_proxy localhost:8080
}
```

`TRUST_PROXY` in `.env.production` ist die Zahl der Proxys vor dem Backend:
`2` mit HTTPS-Proxy davor (Normalfall, so in der Vorlage), `1` ohne. Nur so
sehen die Login-Limits die echte Adresse des Nutzers. Nur für einen kurzen Test
ohne HTTPS: `COOKIE_SECURE=0`.

## Daten und Sicherung

| Was | Wo |
| --- | --- |
| Datenbank | Volume `pg_data` |
| Dokumente | Volume `uploads` (`/data/uploads`), mit `STORAGE=s3` im Objektspeicher |

Beides gehört zusammen: Die Datenbank verweist auf die Dateien.

```bash
ops/backup.sh                      # nach backups/<Datum-Uhrzeit>/ (Datenbank, Dokumente, Prüfsummen)
ops/restore.sh backups/20260930-021500   # zurückspielen – ersetzt den aktuellen Stand, fragt nach
```

`ops/backup.sh` prüft die Datenbank-Sicherung gleich nach dem Schreiben und
behält die letzten 14 Sicherungen (`KEEP=30` für mehr). `ops/restore.sh` prüft
zuerst die Prüfsummen und ändert bei einer beschädigten Sicherung nichts. Eine
Sicherung einer älteren Version lässt sich in eine neuere zurückspielen: Die
Migrationen laufen beim Neustart nach. Täglich per Cronjob:

```
15 2 * * * cd /srv/gartenai && ops/backup.sh >> backups/backup.log 2>&1
```

Die Sicherungen gehören zusätzlich **weg vom Server** (anderer Rechner,
Objektspeicher, NAS) – eine Sicherung auf derselben Platte hilft bei einem
Plattenschaden nicht. Die CI spielt bei jedem Push eine Sicherung zurück:
alles löschen (auch die Volumes), zurückspielen, Anmeldung, Daten und
Dokumente prüfen (`ops/tests/backup-restore.sh`).

### Dokumente im Objektspeicher (S3)

Statt im Volume `uploads` können die Dokumente in einem S3-kompatiblen
Objektspeicher liegen (AWS, Hetzner Object Storage, IONOS, Wasabi, MinIO …).
Das entlastet den Server, wächst ohne Plattenplatz und erlaubt mehrere
Backend-Server nebeneinander.

1. Bucket anlegen (nicht öffentlich), Zugangsschlüssel nur für diesen Bucket.
   Versionierung im Bucket einschalten: Sie ersetzt das Sichern der Dateien.
2. In `.env.production` setzen: `STORAGE=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, bei anderen Anbietern als AWS `S3_ENDPOINT`
   (z.B. `https://fsn1.your-objectstorage.com`) und `S3_REGION`. Optional
   `S3_PREFIX` (eigener Bereich in einem geteilten Bucket) und `S3_SSE=AES256`.
3. Vorhandene Dateien umziehen – vorher als Probelauf:
   ```bash
   docker compose -f docker-compose.prod.yml exec backend node dist/cli/migrate-storage.js --dry-run
   docker compose -f docker-compose.prod.yml exec backend node dist/cli/migrate-storage.js
   ```
   Der Umzug liest jede Datei nach dem Hochladen zurück und vergleicht sie; er
   lässt sich beliebig oft wiederholen (Vorhandenes wird übersprungen). Die
   Pfade in der Datenbank bleiben gleich, die lokalen Dateien bleiben als
   Sicherung liegen.
4. Backend neu starten. Im Log steht `Dokumente im Speicher „s3“`; bei falschem
   Bucket oder Schlüssel `Objektspeicher nicht erreichbar`.

## Aktualisieren

Von Hand auf dem Server:

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Vorher sichern. Migrationen laufen beim Start des neuen Backends automatisch.

### Automatisch ausrollen (GitHub Actions)

Der Workflow „Ausrollen“ (`.github/workflows/deploy.yml`) baut die Images einer Version, legt sie in der
GitHub-Registry ab (`ghcr.io/<owner>/<repo>-backend` und `-frontend`) und startet auf dem Server
`ops/deploy.sh`. Das Skript

1. holt den Code der Version (Compose-Datei, Skripte) per `git` und lädt die Images,
2. sichert die Datenbank (`pg_dump`) und – ohne Objektspeicher – die Dokumente nach `.deploy/backups`
   (die letzten 10 bleiben),
3. startet die neue Version (Migrationen laufen beim Start) und wartet, bis `GET /api/health` die neue
   Versionsnummer meldet,
4. fällt sonst auf die vorige Version zurück und nennt den Befehl, um die Sicherung zurückzuspielen, falls
   Migrationen die Datenbank schon verändert haben.

**Einmalig auf dem Server:** den Projektordner als `git clone` anlegen (bei einem privaten Repository mit
einem Deploy-Key mit Lesezugriff), `.env.production` wie oben, einen Nutzer für das Ausrollen in der Gruppe
`docker`, dessen `~/.ssh/authorized_keys` den öffentlichen Schlüssel enthält.

**Einmalig in GitHub** (Settings → Environments → `production`; dort lässt sich auch eine Freigabe durch
eine Person vor jedem Ausrollen einstellen):

| Secret | Inhalt |
| --- | --- |
| `DEPLOY_HOST` | Adresse des Servers |
| `DEPLOY_USER` | Nutzer für das Ausrollen |
| `DEPLOY_PATH` | Projektordner auf dem Server, z.B. `/srv/gartenai` |
| `DEPLOY_SSH_KEY` | privater SSH-Schlüssel (nur für diesen Zweck erzeugen: `ssh-keygen -t ed25519`) |
| `DEPLOY_KNOWN_HOSTS` | Fingerabdruck des Servers: Ausgabe von `ssh-keyscan <server>` |
| `DEPLOY_PORT` | optional, Standard 22 |

Ohne diese Secrets baut der Workflow nur die Images und meldet, dass nicht ausgerollt wurde. Das Token zum
Laden der Images aus der Registry bringt jeder Lauf selbst mit; es gilt nur während des Laufs.

**Ausrollen:** eine Version taggen – `git tag v1.4.0 && git push origin v1.4.0` – oder unter Actions →
„Ausrollen“ → „Run workflow“ einen Tag oder Commit angeben (leer = aktueller `main`).

**Von Hand auf dem Server** (gleicher Ablauf, z.B. wenn GitHub nicht erreichbar ist):

```bash
GARTENAI_IMAGE=ghcr.io/<owner>/<repo> ops/deploy.sh v1.4.0
GARTENAI_IMAGE=ghcr.io/<owner>/<repo> ops/deploy.sh --rollback   # zurück auf die vorige Version
```

Welche Version läuft, steht in `.deploy/current` und in `GET /api/health` (`version`).

## Texterkennung

Die Sprachdaten (Deutsch, Englisch) sind im Image enthalten, der Server braucht
dafür kein Internet. Wie viele Erkennungen gleichzeitig laufen, regelt
`OCR_CONCURRENCY` (Standard 2; je Erkennung etwa 200–400 MB RAM) – bei mehreren Backend-Instanzen für alle
zusammen (die Plätze liegen in der Datenbank).

## App auf Tablet und Handy

Die Oberfläche ist eine installierbare Web-App: `sw.js` und `manifest.webmanifest` liegen im Frontend-Image
und werden von nginx ohne Cache-Header ausgeliefert. Installieren und offline nutzen geht nur über HTTPS
(Reverse-Proxy davor). Nach einem Update lädt die App beim nächsten Öffnen mit Netz die neue Version.

## Überwachung

- `GET /api/health`: Lebenszeichen ohne Anmeldung (für Uptime-Checks).
- `GET /api/metrics`: Prometheus-Metriken, nur mit `METRICS_TOKEN` als Bearer-Token.
  Beispiel-Konfiguration und Alarmregeln liegen in `ops/prometheus`.
- **Alarmschwellen anpassen:** Das Backend speichert jede Minute einen Messpunkt in der Datenbank
  (Tabelle `MetricSample`): Anfragen, Serverfehler, Antwortzeiten, OCR-Warteschlange, Event-Loop,
  Speicher, fehlgeschlagene E-Mails. Das läuft auch ohne Prometheus. Nach einigen Wochen (ab 14 Tagen)
  zeigt die Auswertung, was normal ist, und schlägt Schwellen vor:
  `docker compose -f docker-compose.prod.yml exec backend node dist/cli/alert-thresholds.js --days 28`
  (`--json` für maschinenlesbar) oder `GET /api/metrics/history?days=28&format=text` mit `METRICS_TOKEN`.
  Je Regel: gemessene Werte (Median, 95/99/99,9 %, Höchstwert), wie oft der Alarm mit der jetzigen und der
  vorgeschlagenen Schwelle ausgelöst hätte, und welche Zeile in `ops/prometheus/alerts.yml` zu ändern ist
  (Text und `alerts.test.yml` mit anpassen, dann `promtool test rules`). Messpunkte älter als
  `METRICS_HISTORY_DAYS` (Standard 90) werden gelöscht; `METRICS_HISTORY=off` schaltet den Verlauf ab.
- Logs: `docker compose -f docker-compose.prod.yml logs -f backend` (eine JSON-Zeile je Anfrage).

## Prüfen

`bash ops/smoke-test.sh` baut und startet den ganzen Stack in einem eigenen
Compose-Projekt und prüft ihn von außen: Einrichtung, Anmeldung, Upload mit
Texterkennung, Frontend, Neustart. Dieselbe Prüfung läuft in der CI
(`.github/workflows/ci-docker.yml`).
