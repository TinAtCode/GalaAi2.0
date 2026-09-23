# GartenAI – Testanleitung (von null zu lauffähig)

Voraussetzung: Node.js 20+, Git, Docker (für Postgres) oder eine eigene PostgreSQL-Instanz.

## 1. GitHub-Repository einrichten (einmalig)

Das Projekt ist bereits ein lokales Git-Repository mit einem ersten Commit (siehe `git log`).
So verbindest du es mit einem echten GitHub-Repo:

1. Auf GitHub ein **leeres** neues Repository anlegen (ohne README/`.gitignore`/Lizenz –
   die gibt es hier schon), z.B. `gartenai`.
2. Im entpackten Projektordner:
   ```bash
   git remote add origin https://github.com/<dein-name>/gartenai.git
   git branch -M main
   git push -u origin main
   ```
3. Danach laufen die mitgelieferten GitHub-Actions-Workflows (`.github/workflows/`) automatisch bei
   jedem Push – dort mit echtem Internetzugang, im Gegensatz zur Entwicklungsumgebung hier also
   auch `prisma generate` und der Playwright-Browser-Download ohne Probleme.
4. Falls die E2E-Pipeline (`ci-e2e.yml`) fehlschlägt: meist liegt es an fehlenden Node-Modulen im
   Cache beim ersten Lauf – ein zweiter Lauf (`Re-run jobs`) behebt das in der Regel.

## 2. Datenbank starten

```bash
cd gartenai
docker compose up -d
```
Das startet PostgreSQL 16 auf Port 5432 (Datenbank `gartenai`, User/Passwort `postgres`/`postgres`).
Ohne Docker: eigene PostgreSQL-Instanz mit einer leeren Datenbank `gartenai` bereitstellen und
`backend/.env` entsprechend anpassen.

## 3. Backend starten

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```
Läuft auf `http://localhost:3000`. Login (aus dem Seed): `admin@musterbetrieb.de` / `demo12345`.

**Datenbank-Änderungen:** Das Schema wird über Migrationen in `prisma/migrations/` verwaltet.
`migrate deploy` wendet alle noch fehlenden Migrationen an. Wer `schema.prisma` ändert, erzeugt mit
`npx prisma migrate dev --name <kurze-beschreibung>` eine neue Migration und committet sie mit.

**Integrationstests** (gegen eine echte PostgreSQL, Datenbank wird dabei geleert – daher eine
eigene Test-Datenbank verwenden):
```bash
createdb -h localhost -U postgres gartenai_test   # einmalig
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gartenai_test?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gartenai_test?schema=public" npm run test:integration
```

## 4. Frontend starten

In einem zweiten Terminal:
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
Läuft auf `http://localhost:5173`, mit demselben Login.

## 5. Kompletten Ablauf durchspielen

Entweder über die API direkt (z.B. mit einem REST-Client) oder teilweise über das Frontend
("Mein Tag", "Kunden" sind angebunden). Kompletter API-Ablauf:

```
POST /auth/login                { "email": "admin@musterbetrieb.de", "password": "demo12345" }
  -> accessToken für alle folgenden Requests als "Authorization: Bearer <token>"

GET  /appointments/my-day        -> zeigt den im Seed angelegten Beispieltermin
GET  /customers                  -> zeigt "Familie Müller"

POST /calculations               { "serviceId": "demo-service-id", "quantity": 10 }
POST /quotes                     { "projectId": "demo-project-id",
                                    "lineItems": [{ "serviceId": "demo-service-id", "quantity": 10 }] }
POST /quotes/:id/approve
POST /quotes/:id/send
POST /quotes/:id/outcome         { "status": "accepted" }
POST /orders                     { "quoteId": "<id von oben>" }
GET  /post-calculation/demo-project-id   -> Soll/Ist für Arbeitszeit und Material
```

**Preislisten-Import (Datenwächter) testen:** eine CSV mit Kopfzeile
`articleNumber,name,unit,purchasePrice,salePrice` (oder deutsch: `Artikelnummer,Bezeichnung,Einheit,
Einkaufspreis,Verkaufspreis`) als `multipart/form-data`-Feld `file` an
`POST /data-guardian/price-list/upload` schicken → liefert eine Vorschau (neue Artikel,
Preis-/Einheitenänderungen). Die zurückgegebenen `rows` unverändert an
`POST /data-guardian/price-list/apply` schicken, um die Änderungen wirklich zu übernehmen.

**OCR testen:** eine PDF oder ein Foto (JPG/PNG) als `multipart/form-data`-Feld `file` an
`POST /ocr/extract` schicken → liefert den erkannten Text und einen geschätzten Dokumenttyp
(z.B. "invoice", "quote"). Bei PDFs mit Textebene (normale, digital erzeugte Dokumente) geht das
sofort und ohne Bild-OCR. Bei gescannten PDFs (keine Textebene) wird jede Seite automatisch als
Bild gerendert und per Bild-OCR gelesen (`method: "pdf-rasterized-ocr"` in der Antwort, max. 10
Seiten). Bei Fotos/Scans (JPG/PNG) läuft dieselbe Bild-OCR direkt über `tesseract.js` – lädt beim
allerersten Aufruf automatisch Sprachdaten (Deutsch+Englisch, insgesamt ca. 20-30 MB) aus dem
Internet nach, danach lokal zwischengespeichert. Braucht also beim ersten OCR-Aufruf kurz
Internetzugang.

**Metriken testen:** in `backend/.env` `METRICS_TOKEN` setzen, Backend neu starten, dann
`curl -H "Authorization: Bearer <Token>" http://localhost:3000/metrics` → Prometheus-Format mit
`http_requests_total`, `http_request_duration_seconds`, `ocr_queue_running` usw. Ohne Token ist
`/metrics` abgeschaltet (404). Beispiel-Konfiguration und Alarmregeln für Prometheus liegen in
`ops/prometheus`; `promtool test rules ops/prometheus/alerts.test.yml` prüft die Regeln.

**Dokumente hochladen/herunterladen testen:** eine beliebige Datei als `multipart/form-data`-Feld
`file` an `POST /documents/upload` schicken (optional `?projectId=...&documentType=invoice` als
Query-Parameter) → legt die Datei unter `backend/uploads/<companyId>/...` ab und registriert die
Metadaten. Mit der zurückgegebenen `id` dann `GET /documents/:id/download` aufrufen, um die Datei
wieder herunterzuladen.

**Rechnungen und E-Rechnung testen:** In den Einstellungen die Firmendaten pflegen (Anschrift und
Steuernummer für jede Rechnung; E-Mail, Telefon und IBAN zusätzlich für die E-Rechnung). Am Projekt mit
Auftrag eine Abschlags- oder Schlussrechnung anlegen, ausstellen, dann „PDF“ bzw. „E-Rechnung“ (XRechnung
als XML-Datei). Der Kunde braucht für die E-Rechnung eine E-Mail-Adresse; bei Behörden die Leitweg-ID als
Käuferreferenz.

**E-Rechnungen prüfen:** `backend/scripts/validate-xrechnung.sh <Ordner>` prüft alle XML-Dateien eines
Ordners gegen XML-Schema, EN 16931 und die XRechnung-Regeln (braucht `git`, `xmllint` und Node.js; lädt
die Regelwerke beim ersten Aufruf). Beispieldateien erzeugt
`XRECHNUNG_OUT=/tmp/xr npx jest test/xrechnung.spec.ts` im Ordner `backend`. Die Warnung BR-DE-19
(IBAN-Prüfsumme) ist ein Rechenfehler von SaxonJS bei langen Zahlen – der offizielle KoSIT-Validator
meldet sie nicht. Verbindlich ist letztlich der [KoSIT-Validator](https://github.com/itplr-kosit/validator)
bzw. die Prüfung beim Empfänger.

**DATEV-Export testen:** in den Einstellungen unter „DATEV-Export“ Berater- und Mandantennummer eintragen
(zum Ausprobieren z.B. 29098 und 55003), Kontenrahmen wählen, speichern. Dann einen Zeitraum mit
ausgestellten Rechnungen wählen und „Buchungsstapel herunterladen“. Die CSV-Datei (Windows-1252) lässt sich
in DATEV Rechnungswesen über Stapelverarbeitung → ASCII-Import einlesen. Die Debitorennummer eines
Kunden steht auf der Kundenseite und kann dort geändert werden.

**PDF/A und ZUGFeRD prüfen:** `backend/scripts/validate-pdfa.sh <Ordner>` prüft alle PDFs eines Ordners
mit veraPDF auf PDF/A-3b und PDFs mit eingebetteter `factur-x.xml` zusätzlich mit dem Mustang-Validator
als ZUGFeRD-Rechnung (braucht Java und Maven; lädt beide Validatoren beim ersten Aufruf). Beispieldateien
erzeugt `PDFA_OUT=/tmp/pdfa npx jest test/zugferd.spec.ts` im Ordner `backend`; mit `PDFA_OUT` beim
Integrationstest kommen die PDFs aller Tests dazu.

## 6. E2E-Tests (Playwright) ausführen

Backend UND Frontend müssen laufen (Schritte 3+4). Die Tests melden sich sehr oft an und laufen alle
als derselbe Nutzer – das Backend dafür mit höheren Limits starten:
`LOGIN_RATE_LIMIT=1000 LOGIN_IP_RATE_LIMIT=1000 RATE_LIMIT=5000 npm run start:dev`. Dann in einem
dritten Terminal:
```bash
cd frontend
npx playwright install chromium   # einmalig, lädt den Browser herunter
npm run test:e2e
```
Testet u.a.: Login-Erfolg/-Fehler, geschützte Route ohne Login, Kalkulation berechnen,
kompletten Angebots-Workflow (Freigeben→Versenden→Annehmen→Auftrag erzeugen, sowie den
Ablehnen-Pfad), Termin anlegen. Die Tests nutzen die Beispieldaten aus dem Seed
(`demo-project-id`, `demo-service-id`) und legen sich bei jedem Lauf ein neues Angebot per
API an – mehrfaches Ausführen ist unproblematisch.

## 7. Wenn etwas nicht passt

- **`429 Too Many Requests` beim Login:** Rate-Limit (5 Versuche/Minute) greift – kurz warten. Für die übrigen Endpunkte liegt das Limit bei 300/Minute je angemeldetem Nutzer (anonym je IP).
- **Nach dem Login sofort wieder abgemeldet:** Das Frontend läuft unter einer Adresse, die das Backend
  nicht kennt – `CORS_ORIGIN` in `backend/.env` auf die Frontend-Adresse setzen (Standard:
  `http://localhost:5173`).

- **`prisma generate` schlägt fehl / hängt:** meist Firewall/Proxy, der `binaries.prisma.sh`
  blockiert (siehe STATUS.md). Auf einer normalen Maschine mit Internetzugang tritt das nicht auf.
- **Migration schlägt fehl:** `DATABASE_URL` in `backend/.env` prüfen, Postgres-Container läuft?
  (`docker compose ps`)
- **Frontend zeigt "Anfrage fehlgeschlagen":** Backend läuft nicht, oder `VITE_API_BASE_URL` in
  `frontend/.env` zeigt auf die falsche Adresse.
- Alles Weitere (Architekturentscheidungen, offene Punkte, Endpunkte) steht in `STATUS.md`.
