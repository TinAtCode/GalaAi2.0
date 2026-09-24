# Betrieb auf einem eigenen Server

GartenAI läuft als drei Container: PostgreSQL, Backend (NestJS) und Frontend
(nginx). Von außen erreichbar ist nur das Frontend; nginx leitet `/api` an das
Backend weiter. Frontend und API haben so dieselbe Adresse, CORS ist nicht nötig.

Voraussetzungen: Docker mit Compose, 2 GB RAM (Texterkennung), ein Reverse-Proxy
mit HTTPS davor (z.B. Caddy, Traefik oder ein vorhandener nginx).

## Erster Start

```bash
cp .env.production.example .env.production
# POSTGRES_PASSWORD und JWT_SECRET setzen mit: openssl rand -hex 32
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

| Was | Wo | Sichern mit |
| --- | --- | --- |
| Datenbank | Volume `pg_data` | `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U gartenai -Fc gartenai > gartenai-$(date +%F).dump` |
| Dokumente | Volume `uploads` (`/data/uploads`) | `docker run --rm -v <projekt>_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .` |

Beides gehört zusammen: Die Datenbank verweist auf die Dateien. Zurückspielen
der Datenbank mit `pg_restore -U gartenai -d gartenai --clean`.

## Aktualisieren

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Vorher sichern. Migrationen laufen beim Start des neuen Backends automatisch.

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
