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
npx prisma migrate dev --name init
npx prisma db seed
npm run start:dev
```
Läuft auf `http://localhost:3000`. Login (aus dem Seed): `admin@musterbetrieb.de` / `demo12345`.

**Hinweis:** Das Datenmodell wurde zusätzlich von Hand als SQL geschrieben und gegen eine echte
PostgreSQL-Instanz getestet (`prisma/validation.sql`, `prisma/validation-seed.sql`) – alle Tabellen,
Fremdschlüssel und die kompletten Join-Pfade (Mandantentrennung, Nachkalkulation) wurden erfolgreich
angelegt und abgefragt. Der reguläre Weg oben (`prisma migrate dev`) ist trotzdem der richtige –
die beiden SQL-Dateien sind nur ein zusätzlicher Vertrauensbeweis, kein Ersatz.

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

**Dokumente hochladen/herunterladen testen:** eine beliebige Datei als `multipart/form-data`-Feld
`file` an `POST /documents/upload` schicken (optional `?projectId=...&documentType=invoice` als
Query-Parameter) → legt die Datei unter `backend/uploads/<companyId>/...` ab und registriert die
Metadaten. Mit der zurückgegebenen `id` dann `GET /documents/:id/download` aufrufen, um die Datei
wieder herunterzuladen.

## 6. E2E-Tests (Playwright) ausführen

Backend UND Frontend müssen laufen (Schritte 3+4), dann in einem dritten Terminal:
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

- **`429 Too Many Requests` beim Login:** Rate-Limit (5 Versuche/Minute) greift – kurz warten. Für die übrigen Endpunkte liegt das Limit bei 100/Minute pro IP.

- **`prisma generate` schlägt fehl / hängt:** meist Firewall/Proxy, der `binaries.prisma.sh`
  blockiert (siehe STATUS.md). Auf einer normalen Maschine mit Internetzugang tritt das nicht auf.
- **Migration schlägt fehl:** `DATABASE_URL` in `backend/.env` prüfen, Postgres-Container läuft?
  (`docker compose ps`)
- **Frontend zeigt "Anfrage fehlgeschlagen":** Backend läuft nicht, oder `VITE_API_BASE_URL` in
  `frontend/.env` zeigt auf die falsche Adresse.
- Alles Weitere (Architekturentscheidungen, offene Punkte, Endpunkte) steht in `STATUS.md`.
