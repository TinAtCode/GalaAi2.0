# GartenAI – Projektstatus

> Zentrale Anlaufstelle: Stand, Entscheidungen, offene Punkte, nächste Schritte.
> Wird knapp gehalten – Details stehen im Code/in den Tests, nicht hier.

Letzte Aktualisierung: 06.10.2026 – Bautagebuch mit Verzögerungen; davor Lageplan für die Entwässerung (Formstücke, Höhen, Leerrohre, Gebäude, Einkaufsliste); davor GartenAI im Büro (Mini-Vollversion auf einem Rechner, Ersteinrichtung im Browser, automatische Sicherung); davor Demo-Agent (KI-Funktionen ohne echte KI vorführen); davor Zeichnungs-KI für den Lageplan; davor KI mit Bildern (Beleg lesen, Baustellenfoto beschreiben); davor KI-Aufgaben (Anbieter und Modell je Aufgabe, Angebotstext, Zusammenfassung der Baustelle); davor Push-Nachrichten für die Baustelle; davor Abwesenheiten in der Plantafel, Sicherung mit Zurückspiel-Test in der CI; davor offenes KI-Gateway (eigene APIs, eigene Agenten, selbst gehostet) und Demo-Paket für Vorführungen (ein Laptop, Handys im WLAN); davor Prüfung aller neuen Module (Ladezeit, Offline-Start, Sicherheit, Verträge, Tests; siehe Nachtrag „Prüfung nach dem Ausbau“); davor Baustelle auf dem Handy, automatisches Ausrollen, Stammdaten-Import, S3-Objektspeicher, Pflegeverträge, Plantafel; am 25.09.2026 Code-Review mit Korrekturen, modernisierte Oberfläche (Dunkelmodus, Schnellsuche), Zahlungen auf Mahnkosten, MT940/CSV, DXF-Import, Aufmaß offline, OCR über mehrere Server; davor Lagepläne mit Rundungen, Kreisen und Schächten; Mahngebühren, Verzugszinsen und Verzugspauschale (optional); Lagepläne mit Übernahme der Mengen ins Angebot. Die Nachträge in Abschnitt 5 beschreiben jeden Ausbauschritt im Detail.

---

## 1. Stand nach Phasen

| Phase | Bereich | Status |
|---|---|---|
| 1 | Architektur | ✅ |
| 2–4 | Datenmodell, Auth, Rollen/Rechte | ✅ |
| 5 | Frontend-Grundlayout | ✅ React/Vite-Grundgerüst: Login, Navigation, "Mein Tag", Kunden, Theming |
| 6 | Kunden/Objekte/Projekte | ✅ |
| 7 | Stammdaten (Artikel, Dienstleistungen/Rezepturen, Lieferanten, Maschinen) | ✅ |
| 8 | Kalkulation (konfigurierbar: Material+Arbeitszeit+Gemeinkosten+Aufschlag) | ✅ |
| 9 | Angebote (Preis-Snapshot) / Aufträge (aus angenommenem Angebot) | ✅ |
| 10 | Terminplanung + "Mein Tag" | ✅ |
| 11 | Mitarbeiter / Selbstbedienungs-Zeiterfassung | ✅ |
| 12 | Dokumente + OCR + Objektspeicher | ✅ echter Datei-Upload/-Download + Text-/Bild-OCR inkl. gescannter PDFs (Rasterisierung) |
| 13 | Datenwächter (Preislisten-Diff + Datei-Upload CSV/XLSX + zeilenweise Auswahl) | ✅ |
| 14 | KI-Gateway | ✅ bewusst offen: OpenAI-kompatibel (auch selbst gehostet), Anthropic oder eigener Agent, je Firma einstellbar; je Aufgabe eigener Anbieter und eigenes Modell (`KI-ANBINDUNG.md`) |
| 15 | Nachkalkulation (Arbeitszeit + Material, Soll/Ist) | ✅ |
| — | E2E-Tests (Playwright), Lint/Format (ESLint+Prettier), CI (GitHub Actions), Container-Rauchtest | ✅ laufen bei jedem Push |
| — | Rechnungen, E-Rechnung, ZUGFeRD, Zahlungen, Mahnwesen, Bankabgleich, DATEV, Dokumente, Finanzen, Betrieb | ✅ siehe Nachträge in Abschnitt 5 |
| 16 | Mobile App | ✅ als installierbare Web-App (PWA): Aufmaß offline, Baustelle mit Tagesplan, Zeiten, Fotos und Nachrichten |
| 17–18 | weitere Schnittstellen (GAEB, DATANORM), Admin-Auslagerung | ⬜ GAEB zurückgestellt |

Backend: NestJS 11.2 (Express 5; bewusst noch nicht NestJS 12 – reines ESM, eigener Umbau) + Prisma 5 + PostgreSQL. Frontend: React 18 + React Router 7 + Vite 8 + TypeScript, kein UI-Framework (bewusst reines CSS mit Design-Tokens, siehe Abschnitt 4).
Tests: `cd backend && npm test` (263 Unit-Tests), `npm run test:integration` (über 200 Integrationstests gegen eine echte PostgreSQL, siehe `TESTANLEITUNG.md`), `cd frontend && npm test` (12 Unit-Tests) und `npm run test:e2e` (48 Playwright-E2E-Tests, 1 davon bewusst übersprungen, 1 nur mit fertigem Build: `E2E_PWA=1`). Dazu `bash ops/smoke-test.sh` für die Produktions-Container. Lint und Formatierung in beiden Projekten ohne Befund.

---

## 2. Projektstruktur (Kurzüberblick)

**Schnellstart:** siehe `TESTANLEITUNG.md` (Docker Compose für Postgres, dann Backend, dann Frontend).

```
gartenai/backend/src/
  auth/, customers/, properties/, projects/, roles/, permissions/,
  articles/, services-catalog/, company/, calculations/, quotes/, orders/,
  suppliers/, machines/, appointments/, employees/, time-entries/,
  material-usage/, post-calculation/, documents/, data-guardian/, ai-gateway/
  common/        Permission-Konstanten, Guards, price-visibility.ts
  prisma/        schema.prisma, seed.ts (komplette Beispielkette)

gartenai/frontend/tests/e2e/   Playwright-E2E-Tests (Login, Kalkulation, Angebots-Workflow, Termine)
gartenai/.github/workflows/    GitHub-Actions-CI (Lint+Unit-Tests, E2E-Tests)
```

Jedes Modul folgt demselben Muster: Controller (Guards + Permissions) → Service
(Mandantenprüfung über die Kette bis zur Company) → Prisma.

**Lokal starten:**
```bash
cd backend
cp .env.example .env   # DATABASE_URL anpassen
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```
Login (Seed): `admin@musterbetrieb.de` / `demo12345`.
Kompletter Testablauf (Kalkulation → Angebot → Auftrag) steht als Kommentar in `prisma/seed.ts`.

```
gartenai/frontend/src/
  theme/     ThemeContext.tsx – Farben als CSS-Variablen, live änderbar, in localStorage persistiert
  auth/      AuthContext.tsx, LoginPage.tsx – JWT-Login gegen POST /auth/login
  api/       client.ts – schlanker fetch-Wrapper (Base-URL aus VITE_API_BASE_URL)
  layout/    AppShell.tsx – eine Navigation, zwei Darstellungen (Bottom-Bar mobil, Seitenleiste ab 900px)
  pages/     MyDayPage (GET /appointments/my-day), CustomersPage (GET /customers), SettingsPage (Theming)
  styles/    tokens.css (Design-Tokens), global.css
```

**Frontend lokal starten:**
```bash
cd frontend
cp .env.example .env   # VITE_API_BASE_URL anpassen, falls Backend woanders läuft
npm install
npm run dev
```

---

## 3. Wichtige Architektur-Entscheidungen

- **Mandantentrennung**: jede Mandanten-Tabelle trägt ihre `companyId` selbst (auch Objekt, Projekt, Angebot, Auftrag, Termin, Zeiteintrag, Materialbuchung), jede Abfrage filtert direkt darüber. Beim Anlegen wird geprüft, dass das Elternobjekt zur selben Firma gehört. Die Integrationstests prüfen über HTTP, dass Firma B an keinem Endpunkt Daten von Firma A lesen oder ändern kann. Zentral erzwungen: Datenbank-Trigger `tenant_guard` lehnen Verknüpfungen über Firmengrenzen ab (Angebot → fremdes Projekt, Rolle → fremder Nutzer, Rezeptur → fremder Artikel usw.), und der `PrismaService` lässt Listen- und Massenabfragen (`findMany`, `findFirst`, `count`, `updateMany`, `deleteMany` …) auf Mandanten-Tabellen nur mit `companyId`-Filter zu (`src/prisma/tenant-guard.ts`).
- **Preisrechte**: serverseitig über `applyPriceVisibility()` / `maskCalculationResult()` – fehlende Berechtigung entfernt Felder komplett aus der Antwort, nicht nur im UI versteckt.
- **Preis-Snapshot bei Angeboten**: `costPerUnit`/`unitPrice`/`marginPerUnit` liegen direkt auf `QuoteLineItem`, nicht als Live-Referenz – spätere Preisänderungen wirken sich nie rückwirkend aus (Punkt 21).
- **Kalkulationsgrundwerte** (Stundensatz, Gemeinkosten-%, Aufschlag-%) sind pro Firma konfigurierbar, mit optionalem Override pro Anfrage – keine starre Marge (Punkt 20).
- **Zeiterfassung ist Selbstbedienung**: ein User bucht strukturell nur auf sein eigenes verknüpftes `Employee`-Profil, nie auf eine im Body übergebene ID.
- **Terminkollisionsprüfung**: verhindert, dass derselbe Mitarbeiter zwei sich überschneidende Termine bekommt; ohne `endTime` wird eine Standarddauer von 1h angenommen, geprüft wird nur derselbe Kalendertag (Überschneidungen über Mitternacht sind für dieses Geschäftsfeld irrelevant), stornierte Termine blockieren nichts mehr.
- **Überstunden**: EINE konfigurierbare Regelarbeitszeit pro Tag pro Firma (`regularDailyHours`, Standard 8h) statt komplexer Schichtmodelle – bewusste Vereinfachung für V1. Nur abgeschlossene/freigegebene Zeiteinträge zählen mit, ein noch laufender Eintrag fließt nicht ein. `overtimeSurchargePercent` ist als Feld vorbereitet, aber noch nicht mit der Lohnvorbereitung verknüpft (Punkt 29 nennt das explizit als "später").
- **Nachkalkulation** vergleicht Soll (aktuelle Rezeptur × Menge aus Auftrag/Angebot) gegen Ist (gebuchte Zeiten/Material) – kein Snapshot der Soll-Werte, daher können sich rückwirkend Soll-Werte leicht verschieben, wenn sich eine Rezeptur später ändert. Material wird zum aktuellen Einkaufspreis bewertet (keine Snapshot-Bewertung zum Buchungszeitpunkt).
- **KI-Gateway**: eine `AiProvider`-Schnittstelle, die Anbieter richtet jede Firma selbst ein (Tabelle `AiProviderConfig`, Schlüssel verschlüsselt): OpenAI-kompatibel, Anthropic oder eigener Agent über einen festen HTTP-Vertrag. Ohne Einrichtung antwortet ein Platzhalter. Jeder Aufruf wird im Audit-Log protokolliert, der Kontext nach den Rechten des Fragenden gefiltert.
- **Objektspeicher (Dokumente)**: dasselbe Muster wie beim KI-Gateway – eine `FileStorage`-Schnittstelle + Injection-Token, wahlweise `LocalDiskStorage` (Dateien unter `UPLOADS_DIR`, pro Firma in eigenem Unterordner) oder S3-kompatibler Objektspeicher (`STORAGE=s3`, siehe Nachtrag „Dokumente im Objektspeicher“). Datei-Upload/-Download real per HTTP getestet: Byte-für-Byte identischer Inhalt nach Upload+Download-Roundtrip.
- **Datenwächter**: Diff-Erkennung (neu/Preisänderung/Einheitenänderung) ist eine reine, getestete Funktion. `apply` unterstützt jetzt auch zeilenweise Auswahl über ein optionales `acceptedArticleNumbers`-Feld (Punkt 16: "teilweise übernehmen") – ohne dieses Feld bleibt das bisherige Verhalten (alles übernehmen) der Standard. Bewusst ohne eigene Staging-Tabelle: der Client ruft zuerst `analyze` auf und entscheidet selbst, welche Artikelnummern er übernehmen will. Datei-Import (CSV/XLSX) mit toleranter Spaltenerkennung (deutsche/englische Kopfzeilen, deutsches Zahlenformat) ist real per Datei-Upload möglich.
- **OCR**: PDFs mit Textebene werden direkt und ohne Bild-OCR ausgelesen (`pdf-parse`). PDFs OHNE Textebene (gescannt) werden jetzt vollständig verarbeitet: `pdf-parse` rendert jede Seite als echtes Bild (`getScreenshot()`, keine zusätzliche Abhängigkeit nötig), jede Seite läuft durch dieselbe Bild-OCR-Engine wie direkt hochgeladene Fotos, Ergebnisse werden zusammengeführt (Deckel: max. 10 Seiten, siehe offene Punkte). Die OCR-Engine selbst ist wie beim KI-Gateway/Objektspeicher austauschbar (`ImageOcrEngine`-Interface + Token), aktuell `TesseractOcrEngine`. Dokumenttyp-Erkennung läuft über einfache Schlüsselwortsuche im extrahierten Text, keine KI nötig.
- **Datenbank-Indizes**: alle Fremdschlüssel-Spalten (`companyId`, `projectId`, `customerId`, etc.) haben jetzt einen `@@index` – ohne das würde jede Mandantentrennungs-Abfrage einen Full-Table-Scan machen, sobald Tabellen wachsen. Bereits `@unique`/`@@unique`-Felder wurden bewusst NICHT zusätzlich indiziert (redundant, da Unique-Constraints in Postgres automatisch einen Index erzeugen).
- **Rate-Limiting**: global 100 Anfragen/Minute pro IP (`@nestjs/throttler`), Login zusätzlich auf 5/Minute begrenzt (Brute-Force-Schutz). Beides real per HTTP getestet (429 nach Limit-Überschreitung).
- **Security-Header**: `helmet()` global aktiv (entfernt `X-Powered-By`, setzt `X-Content-Type-Options`, `X-Frame-Options` etc.) – real per HTTP-Header-Vergleich verifiziert.
- **CORS** nur für die eigenen Frontends: `CORS_ORIGIN` (kommagetrennt), ohne Wert das lokale Vite-Frontend. Mit Cookies wäre „offen für alle“ nicht mehr vertretbar.
- **Sitzung im httpOnly-Cookie** (`gartenai_session`, `SameSite=Lax`, `Secure` in Produktion bzw. `COOKIE_SECURE`): JavaScript im Browser kommt nicht an das Token. Ändernde Anfragen mit Cookie brauchen `X-Requested-With` (CSRF-Schutz). `GET /auth/me` stellt die Sitzung nach dem Neuladen wieder her, `POST /auth/logout` löscht das Cookie. API-Clients (Tests, spätere Mobile-App) schicken das Token weiter als Bearer-Header. Betrieb: Frontend und API unter derselben Domain (z.B. `app.` und `api.` einer Domain); liegen sie auf verschiedenen Domains, `COOKIE_SAMESITE=none` und HTTPS.
- **OCR-Warteschlange**: alle Texterkennungen laufen über eine Warteschlange mit begrenzter Parallelität (`OCR_CONCURRENCY`, Standard 2). `POST /ocr/jobs` legt einen Auftrag an und antwortet sofort (202), `GET /ocr/jobs/:id` liefert Status und Ergebnis; `POST /ocr/extract` wartet wie bisher auf das Ergebnis. Die Datei liegt nur bis zur Verarbeitung im Speicher; nach einem Neustart werden unterbrochene Aufträge als fehlgeschlagen markiert. Das Limit gilt über alle Server-Instanzen zusammen: die Plätze liegen in PostgreSQL (`OcrSlot`, vergeben mit `FOR UPDATE SKIP LOCKED`, alle 30 s verlängert, nach 2 min ohne Lebenszeichen frei); Aufträge geben ein Lebenszeichen, aufgeräumt werden nur verwaiste Aufträge. Die Datei bleibt bis zur Verarbeitung im Speicher des annehmenden Servers.
- **Logging**: `LOG_FORMAT=json` für den Betrieb (eine JSON-Zeile pro Ereignis für Log-Sammler), sonst lesbare Ausgabe. Je Anfrage eine Zeile mit Methode, Pfad ohne Query, Status, Dauer, Nutzer/Firma und Request-ID (vom Proxy übernommen oder erzeugt, in `X-Request-Id` zurückgegeben); 5xx mit Stacktrace. Keine Bodies, Cookies oder Tokens im Log.
- **Metriken**: `GET /metrics` im Prometheus-Format, nur mit `METRICS_TOKEN` als Bearer-Token (ohne Token abgeschaltet, 404). Anfragen je Methode, Routen-Muster (`/customers/:id`, nie echte IDs) und Status, Antwortzeiten als Histogramm, OCR-Warteschlange (laufend/wartend), fehlgeschlagene E-Mails, dazu Prozesswerte (CPU, Speicher, Event-Loop). Beispiel-Konfiguration und Alarmregeln (Backend nicht erreichbar, Serverfehler über 5 %, langsame Antworten, OCR-Stau, fehlgeschlagene E-Mails, blockierter Event-Loop, Speicher) in `ops/prometheus`; die CI prüft die Regeln mit `promtool` samt Regeltests.
- **Anfrage-Limit** 300/Minute je angemeldetem Nutzer, anonym je IP (`RATE_LIMIT`, `common/user-throttler.guard.ts`). Vorher 100/Minute je IP – Kollegen hinter derselben Büro-IP teilten sich ein Kontingent.
- **E2E-Tests (Playwright)**: 21 Tests für die kritischen User Journeys (Login, Sitzung im Cookie, geschützte Routen, Kalkulation, Angebot im Formular anlegen, kompletter Angebots-Workflow inkl. Ablehnen-Pfad, Rechnung mit PDF und E-Rechnung, Termine, Stammdaten, Kunden/Objekte/Projekte, Team-Freigabe, Benutzerverwaltung). Für Tests, die nicht das Anlegen selbst prüfen, werden Angebote per API vorbereitet (Arrange-Schritt).
- **Lint/Format**: ESLint + Prettier in Backend UND Frontend ergänzt (fehlte vollständig) – 0 Fehler nach Behebung von zwei echten, kleinen Funden (ein ungenutzter Import, ein fehlendes React-Hook-Dependency).
- **Build-Konfiguration korrigiert**: `nest build` kompilierte ohne `tsconfig.build.json` versehentlich auch `test/` und `prisma/seed.ts` mit in den Produktions-Build, und `main.js` landete unter `dist/src/main.js` statt `dist/main.js`. Beides gefunden und behoben (Standard-NestJS-Konvention), real mit `node dist/main.js` gegengetestet.
- **Frontend-Theming**: Farben liegen als CSS-Variablen (`--color-primary` etc.), nicht hart codiert in Komponenten. Die Einstellungen-Seite schreibt diese zur Laufzeit um und speichert in `localStorage` – kein Rebuild nötig, direkt live sichtbar.
- **Design-Tokens bewusst gegen SaaS-Klischees gewählt**: Moos-Grün/Ocker statt Standard-Blau oder Terracotta, IBM Plex Sans + Space Grotesk statt Systemschrift, "Mein Tag" als bewusst herausgehobener Bildschirm statt gleichförmigem Card-Raster.

---

## 4. Frontend – Umsetzungsstand

Vorgaben (moderne Apps als Vorbild, einfach anpassbare Farben, durchgehend Touch)
sind in Phase 5 umgesetzt: React + Vite, Theming-System per CSS-Variablen +
Einstellungen-Seite mit Live-Farbwahl, responsive Navigation (Bottom-Bar mobil,
Seitenleiste ab 900px, Punkte permission-abhängig ein-/ausgeblendet), Login gegen
das Backend. Echte Datenseiten: Mein Tag (inkl. Zeiterfassungs-Start/Stopp-Widget),
Kunden, Projekte, Projekt-Detail (Termine, Angebote mit freien Positionen,
Aufträge, Rechnungen mit Zahlungen, Dokumente mit Texterkennung), Kalkulation,
Stammdaten, Offene Posten mit Mahnwesen, Bankabgleich, Finanzen, Team
(Zeiteinträge ansehen und freigeben) und Einstellungen (Firma, DATEV, Nutzer,
Rollen, Protokoll). Jeder Punkt erscheint nur mit dem passenden Recht.

---

## 5. Validierungsstand (wichtig vor deinem Test)

In dieser Sandbox war kein Netzwerkzugriff auf `binaries.prisma.sh` möglich (Egress-Proxy blockiert
den Host explizit) – deshalb konnte `npx prisma generate` hier nicht laufen. **Auf deiner Maschine
mit normalem Internetzugang ist das kein Problem.** Um trotzdem so weit wie möglich real zu prüfen,
statt nur zu behaupten, dass es funktioniert:

- **Datenmodell**: von Hand nach SQL übersetzt und gegen eine echte, lokal installierte PostgreSQL
  16 angewendet (`prisma/validation.sql`) – alle 22 Tabellen, Fremdschlüssel und Unique-Constraints
  wurden ohne Fehler angelegt.
- **Kompletter Datenfluss**: eine vollständige Testkette (Firma→Rolle→User→Mitarbeiter→Kunde→
  Objekt→Projekt→Artikel→Dienstleistung→Rezeptur→Angebot→Position→Auftrag→Termin→Zeiteintrag→
  Materialverbrauch→Audit-Log) wurde real eingefügt (`prisma/validation-seed.sql`) – keine
  Constraint-Verletzung. Die exakten Mehrfach-Joins, die der Code für Mandantentrennung und
  Nachkalkulation nutzt, wurden gegen diese Daten abgefragt und lieferten korrekte Ergebnisse.
- **Komplette Anwendung**: mit einem Prisma-Dummy (nur `$connect`/`$disconnect`) wurde der gesamte
  NestJS-DI-Graph aller 22 Module erfolgreich aufgebaut (`Test.createTestingModule`) und ein
  echter HTTP-Server gestartet. Geschützte Routen lieferten ohne Token `401`, mit ungültigem Token
  `401`, Validierungspipeline und Routing liefen fehlerfrei durch. Der einzige beobachtete Fehler
  (`500` bei `/auth/login`) kam ausschließlich vom bewusst leeren Prisma-Dummy, nicht von der
  Anwendungslogik.

- **OCR (neu)**: PDF-Textextraktion wurde mit einer selbst erzeugten Test-PDF real geprüft (kein Mock) – inklusive vollem HTTP-Roundtrip (Datei-Upload → Text → Dokumenttyp), Status 201, ohne DB-Abhängigkeit. Bild-OCR (`tesseract.js`) konnte in dieser Sandbox NICHT real getestet werden: die Bibliothek lädt beim ersten Lauf Sprachdaten von `cdn.jsdelivr.net`, das derselbe Egress-Proxy blockiert wie bei Prisma. Der Code ist korrekt implementiert (Standardvorgehen für tesseract.js), aber ungetestet – auf deiner Maschine lädt es die Sprachdaten beim ersten Aufruf automatisch nach (einmalig, danach lokal zwischengespeichert).
- **PDF-Rasterisierung für gescannte PDFs (neu)**: `pdf-parse` rendert PDF-Seiten intern zu echten PNG-Bildern (`getScreenshot()`) – das wurde real getestet: eine selbst erzeugte PDF wurde tatsächlich zu einem gültigen PNG gerendert (verifiziert per PNG-Datei-Header-Bytes) und exakt der gerenderte Bild-Inhalt an die OCR-Engine übergeben. Die OCR-Engine selbst ist dafür austauschbar gemacht (`ImageOcrEngine`-Interface), damit dieser Teil ohne echtes Tesseract/Netzwerk testbar ist. Der komplette HTTP-Aufruf mit der echten Tesseract-Engine wurde ebenfalls ausgeführt und kam exakt bis zur bekannten Netzwerkgrenze (Sprachdaten-Download) – bestätigt, dass die komplette Kette bis dahin korrekt verdrahtet ist.

Fazit: Modell, Verdrahtung und HTTP-Schicht sind real geprüft. Nur die tatsächlichen
Datenbankabfragen über den echten, generierten Prisma-Client liefen nie – das kann ausschließlich
auf deiner Maschine mit funktionierendem `prisma generate` passieren. Eine Docker-Compose-Datei
und eine Schritt-für-Schritt-Anleitung dafür liegen bei (siehe `TESTANLEITUNG.md`).

- **E2E-Tests (neu)**: Der Playwright-Browser-Download ist in dieser Sandbox ebenfalls blockiert
  (`cdn.playwright.dev`, dieselbe Klasse Einschränkung wie bei Prisma/Tesseract) – die Tests selbst
  konnten daher nicht tatsächlich gegen einen Browser ausgeführt werden. Was real geprüft wurde:
  alle 13 Tests werden von Playwright korrekt erkannt und geparst (`npx playwright test --list`),
  eine eigene, strikte TypeScript-Prüfung der Testdateien ist fehlerfrei, und jedes in den Tests
  verwendete `data-testid` wurde automatisiert gegen den tatsächlichen Frontend-Code abgeglichen
  (keine Tippfehler in den Selektoren). Auf deiner Maschine mit normalem Internetzugang installiert
  `npx playwright install chromium` den Browser einmalig und die Tests laufen dann echt.
- **CI/CD-Workflows (neu)**: Beim Schreiben des E2E-Workflows fiel auf, dass `npm run build` im
  Backend bisher `test/` und `prisma/seed.ts` versehentlich mit in den Produktions-Build kompiliert
  hätte und `main.js` am falschen Pfad gelandet wäre – real mit `nest build` + `node dist/main.js`
  nachgestellt und behoben (siehe Abschnitt 3). Die eigentlichen GitHub-Actions-Workflows selbst
  können nur auf einem echten GitHub-Repository laufen, nicht in dieser Sandbox.
- **Nachtrag – erste echte CI-Läufe zeigten rot**: Nach dem Push auf GitHub schlug die Pipeline
  erwartungsgemäß fehl. Zwei echte, im Nachhinein am Workflow-Code identifizierte Ursachen behoben:
  (1) `prisma migrate deploy` erwartet einen `prisma/migrations/`-Ordner, den es in diesem Repo nie
  gab (in der Sandbox nie erzeugbar) → auf `prisma db push` umgestellt. (2) Der Health-Check im
  E2E-Workflow rief einen durch Login geschützten Endpunkt auf → `wait-on` bekam `401` statt `200`.
  Dafür einen neuen, bewusst ungeschützten `GET /health`-Endpunkt ergänzt (real per HTTP ohne Token
  getestet: Status 200). Zusätzlich `npm audit --audit-level=high` in beiden Projekten auf
  nicht-blockierend gestellt, da `xlsx` zwei vom Hersteller aktuell ungefixte High-Findings hat –
  ein harter Abbruch hätte die Pipeline dauerhaft rot gehalten.

- **Nachtrag – erster echter Lauf mit PostgreSQL 16 und Chromium**: Dabei gefunden und behoben:
  (1) `ServiceComponent` hatte keine Prisma-Relation zu `Article` – der Backend-Build und 4 Test-Suites
  schlugen mit dem echten Prisma-Client fehl. (2) `POST /documents` übernahm `storagePath` ungeprüft,
  Download las damit beliebige Serverdateien bzw. Dateien fremder Firmen (`../`) – `read()` ist jetzt auf
  das Firmenverzeichnis begrenzt. (3) Fester Fallback für `JWT_SECRET` entfernt, das Backend startet ohne
  Secret nicht mehr; `main.ts` lädt dafür jetzt `backend/.env` (vorher las nur Prisma diese Datei).
  (4) E2E: das Login-Limit (5/Minute) ließ die Suite scheitern → `LOGIN_RATE_LIMIT` in CI erhöht; zwei
  Selektoren und ein fester Termin (Kollision ab dem zweiten Lauf) korrigiert. Ergebnis: 113 Unit-Tests
  und 12 E2E-Tests (1 bewusst übersprungen) grün, auch bei wiederholten Läufen.

- **Nachtrag – Fundament (Schritt 1 aus `BEWERTUNG.md`)**:
  - Echte Migrationen in `prisma/migrations/` (CI und Anleitung nutzen `migrate deploy` statt `db push`).
    Ein CI-Schritt schlägt fehl, wenn `schema.prisma` ohne passende Migration geändert wird. Die von Hand
    geschriebenen `prisma/validation*.sql` sind entfernt – sie bildeten das alte Schema ab und sind durch
    die echte Migration ersetzt.
  - Integrationstests (`test/integration/`, eigener CI-Job) gegen PostgreSQL: kompletter Angebots-Workflow
    bis zur Nachkalkulation und Mandantentrennung über alle wichtigen Endpunkte.
  - `companyId` direkt in allen Mandanten-Tabellen, Status-Felder als Enums, Kalkulation mit
    `Prisma.Decimal` ohne Zwischenrundung, Tagesgrenzen in der Zeitzone der Firma (`Company.timeZone`).

- **Nachtrag – Schritt 2 (Benutzbarkeit) und Absicherung**, jeweils mit Integrationstests gegen PostgreSQL:
  - Gleichzeitige Anfragen: Sperre pro Mitarbeiter für Zeiterfassung und Termine, bedingte Statuswechsel,
    feste Übergänge für den Auftragsstatus. Die Integrationstests laufen in der CI mit nur 2 Verbindungen,
    damit Verbindungs-Deadlocks sofort auffallen (einer wurde so gefunden und behoben).
  - Benutzerverwaltung (`/users`, Einstellungen), Passwort ändern, Rechte und Sperren wirken sofort
    (`User.tokenVersion`, Rechte werden pro Anfrage live geladen).
  - Bearbeiten für Kunden, Objekte, Projekte und Stammdaten; Preisänderungen, Zeitkorrekturen und
    Freigaben im Audit-Log. Zeiteinträge korrigierbar (vergessenes „Stopp“) mit Pflicht-Begründung.
  - Preislisten-Import in einer Transaktion; `.xlsx` über `read-excel-file` (statt `xlsx` mit
    ungefixten Lücken), `.xls` wird mit Hinweis abgelehnt; `bcrypt` 6.
  - Login-Limit je Konto und IP (`LOGIN_RATE_LIMIT`, `LOGIN_IP_RATE_LIMIT`, `TRUST_PROXY`), Frontend
    leitet bei abgelaufener Sitzung zur Login-Seite, Obergrenzen für Zahlenfelder passend zu den Spalten.

- **Nachtrag – Schritt 3 und 4**: Maschinen in der Kalkulation; Soll-Werte der Nachkalkulation am Angebot
  eingefroren; seitenweises Laden (`take`/`skip`, `X-Total-Count`); fortlaufende Angebotsnummern
  (A-2026-0001) und Umsatzsteuer; Rechnungen (Abschlag, Schluss mit Abzug der Abschläge, Storno) mit
  lückenlosen Nummern (R-2026-0001), Prüfung der Pflichtangaben nach § 14 UStG und Unveränderlichkeit
  ausgestellter Rechnungen per Datenbank-Trigger. Firmendaten in den Einstellungen. Euro-Beträge werden
  jetzt richtig formatiert (Prisma liefert Decimal als Text).

- **Nachtrag – PDF und E-Rechnung**: Angebote und Rechnungen als PDF (`GET /quotes/:id/pdf`,
  `GET /invoices/:id/pdf`). E-Rechnung im Format XRechnung 3.0, Syntax UN/CEFACT CII
  (`GET /invoices/:id/xrechnung`, Button „E-Rechnung“ am Projekt): Abschlag = 326, Schlussrechnung = 380,
  Storno = Gutschrift 381 mit Bezug auf die Originalrechnung; verrechnete Abschläge als negative Menge zum
  positiven Preis (BR-27). Dafür neue Firmendaten (E-Mail, Telefon, Ansprechpartner, IBAN, BIC,
  Zahlungsziel) und beim Kunden die Käuferreferenz/Leitweg-ID; beides wird beim Ausstellen mit
  festgeschrieben. `backend/scripts/validate-xrechnung.sh` prüft XML-Schema, EN 16931 und XRechnung-Regeln
  und läuft in der CI auf allen in den Tests erzeugten E-Rechnungen. Versand per E-Mail (`POST /invoices/:id/send`, Button „Per E-Mail“): PDF und XRechnung im Anhang, an
  die Adresse des Kunden oder eine angegebene, protokolliert im Audit-Log; eingerichtet über `SMTP_URL`
  und `MAIL_FROM`. Versand über Peppol ist nicht geplant (Entscheidung vom 24.09.2026).

- **Nachtrag – ZUGFeRD**: Alle PDFs (Angebote, Rechnungen) sind PDF/A-3b: eingebettete Schrift Liberation
  Sans (maßgleich mit Helvetica, SIL OFL, `backend/assets/fonts`), sRGB-Farbprofil, XMP-Metadaten. Das PDF
  einer ausgestellten Rechnung enthält dieselbe XRechnung als `factur-x.xml` (AFRelationship
  „Alternative“, XMP nach Factur-X 1.0 / ZUGFeRD 2.x, Profil XRECHNUNG) und ist damit eine ZUGFeRD-Rechnung.
  Fehlen Angaben für die E-Rechnung (z.B. IBAN), bleibt es beim lesbaren PDF. `backend/scripts/validate-pdfa.sh`
  prüft mit veraPDF (PDF/A-3b) und dem Mustang-Validator (ZUGFeRD samt XML gegen EN 16931 und XRechnung);
  die CI prüft damit alle in den Tests erzeugten PDFs.

- **Nachtrag – Zahlungen und offene Posten**: Zahlungseingänge werden an der ausgestellten Rechnung
  erfasst (`POST /invoices/:id/payments`: Betrag, Eingangstag, Art Überweisung/bar/sonstige, Notiz;
  Korrektur per `DELETE`), eigene Tabelle `InvoicePayment` – die Rechnung selbst bleibt unverändert.
  Keine Überzahlung, keine Zahlungen auf Entwürfe, Stornos und stornierte Rechnungen; gleichzeitige
  Zahlungen und ein gleichzeitiges Storno werden über Sperren serialisiert. `GET /open-items` bzw. die Seite
  „Offene Posten“ zeigt alle Rechnungen mit Restbetrag, Fälligkeit (Rechnungsdatum + Zahlungsziel in
  Kalendertagen der Firmen-Zeitzone) und Tagen im Verzug. Jede Zahlung und Korrektur steht im Audit-Log.
  Zahlungsbuchungen optional im DATEV-Export (siehe dort). Bankabgleich: siehe Nachtrag „Bankabgleich“.

- **Nachtrag – Mahnwesen**: Aus den offenen Posten heraus Zahlungserinnerung, 1. und 2. Mahnung
  (`POST /invoices/:id/dunning`, Tabelle `DunningNotice`). Nur für überfällige, offene Rechnungen; die
  nächste Stufe erst nach Ablauf der Frist der vorigen; neue Frist = Mahndatum + Einstellung „Frist in
  Mahnungen“ (Standard 7 Tage). Offener Betrag und Frist werden beim Erstellen festgehalten. PDF/A im
  Layout der Rechnung (`GET …/dunning/:id/pdf`) mit Tabelle Betrag/bezahlt/offen und Bankverbindung;
  Versand per E-Mail (`POST …/dunning/:id/send`) nur für die neueste, noch gültige Mahnung – nicht nach
  einer Zahlung, nach Ablauf der Frist oder bei stornierter Rechnung. Erstellen und Versand im Audit-Log.
  Mahngebühren und Verzugszinsen kamen später dazu (optional, siehe Nachtrag „Mahngebühren“).

- **Nachtrag – Freie Angebotspositionen**: Neben Leistungen aus dem Katalog kann ein Angebot freie
  Positionen enthalten (Text, Einheit, Menge, Preis je Einheit, optional Kosten je Einheit für die
  Marge) – z.B. Pauschalen oder Einzelleistungen. Beides gemischt in einer Position lehnt die API ab.
  Freie Positionen haben keine Soll-Werte für die Nachkalkulation. Positionen tragen jetzt eine feste
  Reihenfolge (`position`); vorher lieferte die Datenbank sie ohne ORDER BY in beliebiger Reihenfolge,
  was auf PDF und Rechnung durchschlagen konnte. Mengen höchstens mit 2 Nachkommastellen.
  Entwürfe lassen sich bearbeiten (`PUT /quotes/:id`, Knopf „Bearbeiten“ an der Angebotskarte):
  Positionen und Umsatzsteuer werden ersetzt, Katalog-Leistungen mit der aktuellen Rezeptur neu
  berechnet; die Nummer bleibt. Ab der Freigabe ist das Angebot eingefroren (400). Bearbeiten in der
  Oberfläche braucht Verkaufs- und Einkaufsrechte, damit keine verborgenen Kosten verloren gehen.

- **Nachtrag – DATEV-Export**: `GET /datev/bookings?from=JJJJ-MM-TT&to=JJJJ-MM-TT` (Recht `data.export`,
  Einstellungen → DATEV-Export) liefert die Ausgangsrechnungen als DATEV-Buchungsstapel (EXTF, Version
  700, Formatversion 12, 124 Spalten, Windows-1252, CRLF). Je ausgestellter Rechnung eine Buchung vom
  Debitorenkonto des Kunden auf das Erlöskonto über den Bruttobetrag, Stornorechnungen im Haben;
  Belegdatum in der Zeitzone der Firma, dazu Leistungsdatum und Fälligkeit. Erlöskonten: SKR03
  8400/8300/8195/8337, SKR04 4400/4300/4185/4337 (19 %, 7 %, § 19, § 13b), je Firma änderbar. Kunden
  bekommen fortlaufende Debitorennummern ab 10000 (bestehende per Migration, änderbar, eindeutig je
  Firma). Abschlagsrechnungen gehen direkt auf das Erlöskonto; die Schlussrechnung verrechnet sie
  bereits, die Summe der Erlöse stimmt. Wer „erhaltene Anzahlungen“ getrennt führt, bucht in DATEV um.
  Ein Stapel umfasst höchstens ein Kalenderjahr (Wirtschaftsjahr = Kalenderjahr); jeder Export steht
  im Audit-Log. Auf Wunsch (`&payments=1`, Häkchen „Zahlungseingänge mitexportieren“) kommen die
  Zahlungseingänge des Zeitraums dazu: Bank (SKR03 1200 / SKR04 1800), Kasse (1000 / 1600) bzw. für
  sonstige Zahlungen Geldtransit (1360 / 1460) an Debitor, Belegfeld 1 = Rechnungsnummer für den
  OP-Ausgleich; Konten einstellbar. Standard ist aus, weil viele Kanzleien die Bankumsätze direkt aus dem
  Bankkonto übernehmen – sonst wären sie doppelt gebucht. Noch nicht: Debitoren-Stammdaten (Namen und
  Anschriften) als eigener Export, Belegbilder.

- **Nachtrag – Bankabgleich (CAMT.053)**: Kontoauszug im ISO-20022-Format CAMT.053 (XML, Versionen
  001.02 bis 001.08, wie ihn das Online-Banking liefert) unter „Bankabgleich“ einlesen. Übernommen werden
  nur gebuchte Gutschriften in EUR; Abbuchungen, vorgemerkte Umsätze und Fremdwährung werden gezählt und
  übersprungen. Sammelgutschriften mit Einzelbeträgen werden in Einzelumsätze aufgeteilt. Jeder Umsatz
  hat einen Schlüssel (IBAN + Bankreferenz), derselbe Auszug lässt sich daher gefahrlos mehrfach einlesen.
  Zuordnung: zuerst die Rechnungsnummer im Verwendungszweck (auch „RE 2026 0001“ oder „R20260001“),
  sonst – nur wenn eindeutig – eine offene Rechnung mit genau diesem Restbetrag; der Vorschlag wird bei
  jedem Laden neu berechnet. Gebucht wird erst nach Bestätigung, als normale Zahlung (Bank) zur Rechnung
  mit denselben Prüfungen (kein Überzahlen, kein Storno). Ein Umsatz kann mehrere Rechnungen begleichen:
  er bleibt offen, bis sein ganzer Betrag verteilt ist; eine Zeilensperre auf dem Umsatz verhindert, dass
  gleichzeitige Buchungen zusammen mehr verteilen. Wird eine Zahlung an der Rechnung gelöscht, ist der
  Umsatz wieder offen. Umsätze ohne Rechnungsbezug (oder der Rest nach einer Überzahlung) lassen sich
  ignorieren und wieder öffnen. Ohne Bankreferenz bildet sich der Dublettenschlüssel aus Auszugskennung,
  Position und Merkmalen – nicht aus der vom Zahler gewählten EndToEndId. XML ohne DOCTYPE (Schutz vor
  XXE), Datei höchstens 5 MB. MT940 und CSV siehe Nachtrag vom 25.09.2026. Automatische Abholung per EBICS/FinTS ist nicht geplant (Entscheidung vom 24.09.2026); Auszüge werden hochgeladen.

- **Nachtrag – Dokumente am Projekt**: Abschnitt „Dokumente“ auf der Projektseite (Recht `document.read`):
  mehrere Dateien auf einmal hochladen mit Art (Foto, Lieferschein, Plan, Aufmaß …), herunterladen,
  löschen (mit Audit-Log; eigenes Recht `document.delete`, per Migration an alle Rollen mit
  `system.settings.write`). Auf Wunsch (`POST /documents/upload?…&ocr=1`, Häkchen „Text erkennen“) läuft die
  Texterkennung für PDF und Bilder über die OCR-Warteschlange; Stand (`ocrStatus`) und Text (`ocrText`)
  stehen am Dokument, die Seite lädt nach, bis der Text da ist. `GET /documents/by-project/:id?q=` sucht
  in Dateiname und erkanntem Text; die Liste liefert nur einen Ausschnitt um den Treffer. Beim Löschen
  bleibt die Datei, wenn ein weiteres Dokument auf sie verweist (`storagePath` ist über `POST /documents`
  frei eintragbar, Pfade werden dabei vereinheitlicht); die OCR-Aufträge zum Dokument werden samt
  erkanntem Text mitgelöscht. Nach einem Neustart gilt eine
  unterbrochene Texterkennung als fehlgeschlagen.

- **Nachtrag – Betrieb in Containern** (`BETRIEB.md`): `backend/Dockerfile` (mehrstufig, Laufzeit nur mit
  Produktionsabhängigkeiten, unprivilegierter Nutzer, Migrationen beim Start, Healthcheck),
  `frontend/Dockerfile` (nginx, `/api` → Backend, gleiche Adresse), `docker-compose.prod.yml` mit Volumes für
  Datenbank und Dokumente. Ersteinrichtung ohne Demo-Daten: `node dist/cli/setup-company.js` (Firma, Rollen,
  erster Administrator, alles in einer Transaktion). Die OCR-Sprachdaten (Deutsch, Englisch) kommen jetzt als
  npm-Pakete mit statt zur Laufzeit vom CDN – Texterkennung funktioniert ohne Internet; ein Test prüft die
  echte Erkennung. Das Prisma-CLI ist Laufzeitabhängigkeit (für `migrate deploy`). `ops/smoke-test.sh` startet
  den ganzen Stack und prüft ihn von außen; in der CI als eigener Workflow.

- **Nachtrag – Finanzbereich** (Seite „Finanzen“, neues Recht `finance.read`): eine Übersicht für
  Geschäftsführung und Buchhaltung, keine Buchführung (die bleibt bei DATEV). Der Kontoauszug-Import übernimmt
  jetzt auch Abbuchungen (Gegenpartei = Empfänger; Spalten `counterpartyName`/`counterpartyIban` statt
  `debtor…`) und den gebuchten Schlusssaldo (CLBD) je Konto und Tag (`BankBalance`). Der Bankabgleich zeigt
  weiter nur Zahlungseingänge. `GET /finance/overview`: Kontostand je Konto mit Datum, offene Forderungen
  (gesamt, überfällig, fällig in 30 Tagen), zwölf Monate mit Rechnungsbetrag (brutto, Stornos abgezogen,
  Monat in der Zeitzone der Firma), Zahlungseingängen und Ausgaben. `GET /finance/transactions`: alle
  Kontobewegungen mit Filter (Richtung, Zeitraum, Suche in Name, IBAN, Verwendungszweck), seitenweise.
  Neue Rolle „Buchhaltung“ (per Migration für alle Firmen, auch bei Ersteinrichtung und Seed): Finanzen,
  Rechnungen und Zahlungen, DATEV-Export, Kunden und Dokumente lesen, Verkaufspreise – keine Einkaufspreise,
  keine Nutzer- oder Systemverwaltung. Die Geschäftsführung erhält `finance.read` automatisch.

- **Nachtrag – Finanzen Schritt 2** (Reiter Kontobewegungen, Fixkosten, Jahresüberblick, Kategorien):
  Ausgabenkategorien je Firma (Start: Material, Fahrzeuge, Maschinen, Miete, Personal, Versicherungen, Büro,
  Steuern, Sonstiges – einmalig angelegt, gelöschte kommen nicht wieder) mit Stichwort-Regeln (Name oder
  Verwendungszweck, nur Name, nur Verwendungszweck, IBAN genau; Satzzeichen zählen wie Leerzeichen). Neue
  Abbuchungen werden beim Import zugeordnet: zuerst wie derselbe Empfänger (IBAN, sonst Name) zuletzt von Hand
  zugeordnet wurde, sonst nach der neuesten passenden Regel; eigene Regeln gehen vor den Startregeln. Die
  Quelle steht an der Buchung (Regel, gelernt, von Hand); „ohne Kategorie“ von Hand bleibt so. Ältere
  Abbuchungen ordnet „Automatisch zuordnen“ nach. Fixkosten (`RecurringPayment`: monatlich, viertel-,
  halbjährlich, jährlich, optional mit Enddatum und Kategorie, pausierbar); Vorschläge aus den Abbuchungen der
  letzten 13 Monate (mind. drei gleichmäßige Buchungen, jährlich zwei; Beträge höchstens 10 % auseinander).
  Jahresüberblick `GET /finance/year?year=`: je Monat Eingänge und Ausgaben je Kategorie laut Kontoauszug,
  noch nicht abgebuchte Fixkosten als geplant (Abbuchung gilt als bezahlt bei gleichem Empfänger und Betrag
  höchstens 10 % daneben), erwartete Zahlungseingänge aus offenen Rechnungen nach Fälligkeit; Fixkosten je
  Monat im Schnitt. Monatsende-sicher (31.01. → 28.02. → 31.03.). Alles unter `finance.read`, mandantengetrennt
  per Trigger.

- **Nachtrag – Eingangsrechnungen** (Finanzen → Eingangsrechnungen, `IncomingInvoice`): Beleg einlesen per
  `POST /finance/payables/extract` – E-Rechnungen (XRechnung/ZUGFeRD als CII oder UBL, auch als in die PDF
  eingebettete factur-x.xml) werden exakt übernommen (Lieferant, IBAN, Nummer, Datum, Fälligkeit, Brutto,
  Netto, USt, Skonto nach `#SKONTO#TAGE=…#PROZENT=…#`); Gutschriften werden abgelehnt. PDFs mit Textebene und
  Fotos laufen über die Texterkennung; Betrag, Rechnungsnummer, Daten, Zahlungsziel, Skonto, IBAN (mit
  Prüfsumme, nicht die eigene) und Lieferant (bekannte Lieferanten zuerst) werden vorgeschlagen, bei mehreren
  Treffern als Auswahl. Kategorie: wie beim letzten Beleg des Lieferanten, sonst Gelerntes/Regeln. Doppelt
  erfasste Rechnungen (Lieferant + Nummer) werden erkannt. Der Beleg liegt als Dokument (Typ
  `incoming_invoice`, getrennt von Projektdokumenten). Abgleich mit Abbuchungen: Betrag genau oder abzüglich
  Skonto (bis drei Tage nach der Frist) plus Rechnungsnummer im Verwendungszweck, IBAN oder Name; eindeutige
  Treffer mit Rechnungsnummer werden nach dem Kontoauszug-Import automatisch verbucht, sonst als Vorschlag.
  „Wieder öffnen“ merkt sich die falsche Abbuchung. Bezahlt auch von Hand (Datum, Betrag; Skonto innerhalb der
  Frist automatisch). Offene Rechnungen gehen zum geplanten Zahltag (mit Skonto, solange möglich) in den
  Jahresüberblick und in die **Liquiditätsvorschau** (`GET /finance/forecast`, 13 Wochen: Kontostand +
  erwartete Eingänge − Eingangsrechnungen − Fixkosten; Rechnungen mit schon passender Abbuchung zählen nicht
  doppelt). Alles unter `finance.read`, mandantengetrennt per Trigger.

- **Nachtrag – Mahngebühren und Verzugszinsen** (Einstellungen → Firmendaten, Standard: aus): Gebühr je
  Mahnstufe, Verzugszinsen nach § 288 BGB (Basiszinssatz, den die Firma pflegt, + 5 Prozentpunkte bzw. + 9 bei
  Geschäftskunden; taggenau, Jahr = 365 Tage) und die Pauschale von 40 € bei Geschäftskunden (§ 288 Abs. 5,
  einmal je Rechnung). Neues Merkmal am Kunden: „Geschäftskunde“. Verzugsbeginn: Tag nach der ersten Mahnung
  (auch der Zahlungserinnerung), bei Geschäftskunden spätestens 30 Tage nach Fälligkeit (§ 286 Abs. 3).
  Beträge werden beim Anlegen der Mahnung festgeschrieben (`fee`, `interest`, `interestRate`, `interestFrom`,
  `lumpSum`), in der Mahnung als Aufstellung bis „Zu zahlen“ gezeigt und in den offenen Posten als „zzgl. …
  Gebühren/Zinsen“. Sie sind eine eigene Forderung neben der Rechnung und werden nicht auf die Rechnung
  gebucht.

- **Nachtrag – Lagepläne (Zeichenmodul, Schritt 1)**: Am Projekt „Lagepläne“ anlegen und im Browser
  zeichnen (Maus und Touch): Regenwasser, Schmutzwasser, Rinnen, Fallrohre, Gullies, Erdkabel, Zäune, Tore
  und Türen (Breite), Pflaster-, Rasen- (optional mit Mähkante), Parkplatz- (mit Stellplätzen) und
  Pflanzflächen, Piktogramme (Baum, Strauch, Leuchte, Schacht, Wasser-/Stromanschluss, Bank, Spielgerät),
  Beschriftungen. Hintergrund: Foto, Luftbild oder Plan (PNG/JPEG, PDF → erste Seite als Bild, Exif-Drehung
  berücksichtigt), liegt als Dokument am Projekt. Maßstab über eine bekannte Strecke; ohne Hintergrund
  1-m-Raster. Längen, Flächen, Umfang/Mähkante und Stückzahlen live im Plan und als Mengenliste (auch vom
  Server berechnet, `GET /plans/:id`). Auswählen, Verschieben, Punkte ziehen, Fangen an vorhandenen Punkten,
  Umschalt = rechtwinklig, Rückgängig/Wiederholen, Drucken, Export als SVG. Speichern mit Versionsschutz
  (gleichzeitiges Bearbeiten → 409). Rechte `plan.read` (auch Mitarbeiter) und `plan.write` (wer Kunden/
  Projekte bearbeitet), mandantengetrennt per Trigger. **Schritt 2 – Mengen ins Angebot**: „Ins Angebot
  übernehmen“ zeigt je Mengenzeile die Leistungen mit passender Einheit (Menge umgerechnet, z.B. m → cm,
  `GET /plans/:id/quote-draft`), vorbelegt mit der gemerkten Zuordnung je Firma (`PlanServiceMapping`,
  `PUT /plan-mappings/:key`); das Angebot entsteht über die normale Angebots-API, Kalkulation und Rundung der
  Leistung gelten wie immer. Leitungen liegen immer über den Flächen (auch mitten in Rasen oder Pflaster
  zeichenbar); Regenwasser, Schmutzwasser und Rinnen mit Nennweite (DN), Leitungen mit Verlegetiefe –
  beides im Plan beschriftet, Mengen je DN getrennt (eigene Leistungen im Angebot). Ebenen (Entwässerung,
  Leitungen & Grenzen, Flächen, Symbole) ein- und ausblenden, „Flächen blass“. **Exakte Maße:** beim Zeichnen
  die Länge der nächsten Strecke eintippen (Richtung zur Maus, Umschalt = rechtwinklig); beim ausgewählten
  Objekt alle Kanten (A–B, B–C …) mit Länge im Plan und als Eingabefeld – eine neue Länge verschiebt den
  Endpunkt und die folgenden Punkte bis zum nächsten fixierten (bei Flächen höchstens bis vor die Kante am
  Anfangspunkt, ein Rechteck bleibt rechteckig). Einzelne Punkte oder das ganze Objekt lassen sich fixieren
  (nicht verschiebbar). **Rundungen und Kreise:** beliebig viele Punkte je Fläche oder Leitung („+“ auf
  einer Kante fügt einen Punkt ein, „×“ löscht ihn); jede Ecke mit Radius (an Außenecken Außenrundung, an
  einspringenden Ecken Innenrundung, bei Leitungen Bögen im Knick); jede Kante als Kreisbogen nach außen oder
  innen (bei Leitungen links/rechts) mit Radius; Flächen als Kreis mit Durchmesser. Neues Objekt „Schacht“
  (Entwässerung, standardmäßig rund), gezählt je Durchmesser (`manhole:d100` = Ø 1,00 m, eigene Leistung im
  Angebot). Fläche, Umfang, Mähkante und Leitungslänge rechnen mit den echten Rundungen (Kreis exakt πr²);
  der Umriss (`plans/outline.ts`) ist in Backend und Frontend dieselbe Datei, ein Test hält beide gleich.
  Nächste Schritte: Aufmaß-App offline, DXF-Import.

- **Nachtrag – Einheiten und Rundung** (Stammdaten → Einheiten): Einheitenkatalog in `common/units.ts`
  (mm, cm, m, km, cm², m², ha, l, m³, g, kg, t, Stk, Sack, Palette, h, min, psch) mit Dimension,
  Umrechnungsfaktor und E-Rechnungs-Code; Schreibweisen wie „qm“, „m2“, „Stück“ werden vereinheitlicht (auch
  bestehende Leistungen und Artikel per Migration; Angebote und Rechnungen bleiben unverändert). Umrechnung
  innerhalb einer Dimension (cm → m, t → kg) als Funktion für Aufmaß und Rezepturen vorbereitet. Mengen haben
  jetzt bis zu 3 Nachkommastellen. Rundung der Mengen in vier Stufen – Position → Leistung (später auch Artikel) → Einheit
  → Firma: die erste Stufe mit einer Genauigkeit (0–3 Nachkommastellen oder Schritt, z.B. 0,5) bestimmt
  sie, die Rundungsart (kaufmännisch, aufrunden, abrunden) kommt von der ersten Stufe, die eine festlegt.
  Katalog-Vorgaben: Stück, Sack, Palette ganzzahlig (Sack und Palette aufrunden). Am Angebot stehen die
  gerundete Menge (Summe, PDF, Rechnung, E-Rechnung) und die genaue Menge (Nachkalkulation) samt Quelle der
  Rundung. Geldbeträge bleiben centgenau. `GET/PUT/DELETE /units` für Anpassungen je Einheit und eigene
  Einheiten (Ändern mit `masterdata.write`). Die Rundungsfelder am Artikel sind angelegt, werden aber erst
  mit Aufmaß und Materiallisten genutzt (Angebotspositionen hängen an Leistungen); in der Oberfläche sind sie
  deshalb noch nicht einstellbar. Bestehende Angebotspositionen behalten ihre Menge unverändert (eigene Regel
  „3 Nachkommastellen“ per Migration), damit ein altes Angebot beim Speichern nicht neu gerundet wird.

- **Nachtrag – Belege ohne Umsatzsteuer**: `vatTreatment` an Angebot und Rechnung. Kleinunternehmer
  (§ 19 UStG, Firmeneinstellung) stellen immer ohne USt aus; § 13b UStG wird am Angebot gewählt
  (`vatTreatment: "reverse_charge"`). Die Rechnung übernimmt die Behandlung vom Angebot, das Storno vom
  Original. PDF mit Pflichthinweis; E-Rechnung mit Kategorie E bzw. AE und Befreiungsgrund, bei § 13b mit
  der USt-IdNr. des Kunden (neues Feld am Kunden). 0 % ohne Grund bleibt als E-Rechnung gesperrt.

- **Nachtrag – Audit-Log**: Statuswechsel von Angeboten, Aufträgen und Projekten, Nutzeränderungen
  (Sperren, Namen), Passwort-Reset (ohne das Passwort) sowie Rollenrechte und Rollenzuweisungen werden mit
  handelndem Nutzer, altem und neuem Wert in derselben Transaktion protokolliert. Gleichzeitige
  Statuswechsel: nur einer gelingt und nur dieser steht im Protokoll (Integrationstest). Einsehbar unter Einstellungen → Protokoll (`GET /audit-log`, filterbar, seitenweise; Recht `audit.read`, das die Migration allen Rollen mit `system.settings.write` gibt).

- **Nachtrag – Code-Review und Oberfläche (25.09.2026)**: Aufträge (Summe), Materialverbrauch
  (Einkaufspreis) und Nachkalkulation (Materialkosten) liefern Preise nur mit dem passenden Recht; die
  Nachkalkulation zählt alle nicht stornierten Aufträge; Rechnungen mit Zahlungen lassen sich nicht mehr
  stornieren (erst Zahlungen entfernen, dann der neuen Rechnung zuordnen); Knöpfe im Projekt nur mit dem Recht,
  das das Backend verlangt. Neue Oberflächen für vorhandene Funktionen: Nachkalkulation und Materialverbrauch am
  Projekt, Auftragsstatus, Termine erledigen/absagen, Preislisten-Import (Stammdaten). Suche in Kunden- und
  Projektlisten (`?q=`, Projekte zusätzlich `?status=`), Schnellsuche mit Strg+K. Oberfläche: Schriften lokal
  statt von Google Fonts (Datenschutz), Dunkelmodus (automatisch/hell/dunkel), gruppierte Seitenleiste, mobil
  untere Leiste mit „Mehr“, Karten und einheitliche Formulare, Projektseite zweispaltig mit Sprungmarken,
  Kennzahlen auf „Mein Tag“. Test: jede Mandanten-Tabelle mit Verweis auf eine andere hat den Trigger
  `tenant_guard`.

- **Nachtrag – Zahlungen auf Mahnkosten und Zinsen**: Forderung je Rechnung = Rechnungsbetrag + Gebühren und
  Pauschale aller Mahnstufen + Zinsen der jüngsten Mahnung (`invoices/claims.ts`). Zahlungen werden nach § 367
  BGB verrechnet (erst Kosten, dann Zinsen, dann Rechnungsbetrag) oder auf Wunsch nur auf den Rechnungsbetrag;
  die Anteile stehen an der Zahlung. Mahnkosten lassen sich erlassen (eigene Tabelle, Audit-Log). DATEV: die
  Anteile als Ertrag (SKR03 2700/2650, SKR04 4830/7100, einstellbar) – bitte mit der Kanzlei abstimmen.

- **Nachtrag – Kontoauszüge MT940 und CSV**: neben CAMT.053 auch MT940 (STA) und CSV aus dem Online-Banking;
  das Format wird am Inhalt erkannt, Spalten der CSV über die Überschrift (Sparkasse, Volksbank, DKB u. a.).

- **Nachtrag – DXF-Import**: CAD-Zeichnungen (ASCII-DXF) im Lageplan übernehmen; je Layer die Objektart
  wählen (aus dem Namen vorgeschlagen), Bögen und Kreise bleiben echte Bögen/Kreise, Einheit aus `$INSUNITS`.

- **Nachtrag – Aufmaß offline**: installierbare App (Manifest, Service Worker nur im Build); zuletzt
  geöffnete Lagepläne samt Hintergrund liegen im Gerät (IndexedDB); offline gespeicherte Änderungen werden bei
  Netz übertragen, bei zwischenzeitlicher Änderung auf dem Server entscheidet der Nutzer (keine stille
  Überschreibung). Abmelden und Nutzerwechsel löschen die Offline-Daten.

- **Nachtrag – Verlauf für die Alarmschwellen**: Das Backend speichert jede Minute je Server einen Messpunkt
  (`MetricSample`: Anfragen, Serverfehler, Antwortzeiten je Bucket, OCR-Warteschlange, Event-Loop, Speicher,
  fehlgeschlagene E-Mails; nur Summen über alle Firmen). Die Auswertung (`node dist/cli/alert-thresholds.js`
  oder `GET /metrics/history` mit `METRICS_TOKEN`) rechnet wie die Alarmregeln (5-Minuten-Fenster, „am Stück“)
  und schlägt je Regel eine Schwelle vor: der Wert, den 99,9 % der Minuten nicht überschreiten, mit Aufschlag
  und Untergrenze, auf eine runde Zahl aufgerundet; dazu, wie oft der Alarm mit der alten und der neuen Schwelle
  ausgelöst hätte. Unter 14 Tagen Daten gelten die Vorschläge als vorläufig. Aufbewahrung 90 Tage
  (`METRICS_HISTORY_DAYS`), abschaltbar mit `METRICS_HISTORY=off`. Ein Test prüft, dass die bekannten
  Schwellen zu `ops/prometheus/alerts.yml` passen.

- **Nachtrag – Pflege- und Wartungsverträge**: Vertrag am Projekt (`MaintenanceContract`) mit Positionen je
  Abrechnungszeitraum (monatlich bis jährlich, im Voraus oder nachträglich) und wiederkehrenden Einsätzen
  (`ContractTask`: Rhythmus in Wochen, Saison auch über den Jahreswechsel, Uhrzeit, Dauer, Mitarbeiter).
  `POST /contracts/schedule` legt fällige Einsätze bis zu einem Datum (höchstens ein Jahr) als Termine an –
  ohne Doppelte, bei Überschneidung ohne Mitarbeiter. `POST /contracts/invoice-due` bzw. `/contracts/:id/invoice`
  erstellt Rechnungsentwürfe (Rechnungsart `periodic`, E-Rechnung 380, Leistungszeitraum). Der nächste Zeitraum
  folgt aus den nicht stornierten Rechnungen, ein Storno gibt ihn wieder frei; am Vertragsende wird der letzte
  Zeitraum gekürzt (Betrag unverändert). Rechnungen gehören jetzt zu einem Auftrag oder einem Vertrag
  (Check-Constraint). Rechte: ansehen mit `customer.read` (Preise nur mit `price.sale.read`), anlegen mit
  `customer.write` und `price.sale.read`, planen mit `customer.write`, abrechnen mit `invoice.create`.
- **Nachtrag – Plantafel**: `GET /appointments/board?from=&days=` liefert die Termine aller Mitarbeiter eines
  Zeitraums (ohne abgesagte) und die zuteilbaren Mitarbeiter, `PATCH /appointments/:id` verschiebt und teilt
  neu zu (Dauer bleibt, dieselbe Kollisionsprüfung wie beim Anlegen). Seite „Plantafel“: Mitarbeiter ×
  Wochentage, Ziehen mit der Maus, Dialog zum Antippen (Touch), Tage über 8 Stunden markiert.
- **Nachtrag – Stammdaten-Import mit Abgleich**: Kunden, Lieferanten, Artikel und Maschinen aus Excel (.xlsx),
  CSV/Text (Trennzeichen und Zeichensatz UTF-8/Windows-1252 werden erkannt), aus Excel kopiertem Text, JSON oder
  vCard (Kontakte). `POST /master-data-import/upload` bzw. `/text` liest ein (höchstens 5000 Zeilen; die Quelle
  liegt bis zur Übernahme, längstens einen Tag, in `ImportSession`), schlägt Datenart und Spalten vor.
  `POST /master-data-import/:id/preview` gleicht mit dem Bestand ab – Kunden über Debitorennummer, E-Mail, Name
  und PLZ, Name; Lieferanten über Name oder E-Mail; Artikel über die Artikelnummer; Maschinen über den Namen –
  und zeigt je Zeile neu, geändert (alt → neu), unverändert, mögliche Dublette (ähnlicher Name, Rechtsform
  ignoriert) oder Fehler (auch doppelt in der Quelle oder derselbe Bestandseintrag zweimal). Leere Zellen
  überschreiben nichts. `POST /master-data-import/:id/apply` übernimmt die ausgewählten Zeilen in einer
  Transaktion nach erneutem Abgleich, mit Audit-Log. Rechte: `data.import` und `masterdata.write`, für Artikel
  und Maschinen zusätzlich die Preisrechte. Oberfläche: Stammdaten → „Stammdaten importieren“.
- **Nachtrag – Dokumente im Objektspeicher**: `STORAGE=s3` legt Dokumente, Lageplan-Hintergründe und Belege in
  einem S3-kompatiblen Bucket ab (AWS, Hetzner, IONOS, Wasabi, MinIO …; `S3_*`-Variablen, optional Präfix und
  serverseitige Verschlüsselung). Schlüssel wie im Dateisystem (`<companyId>/<datei>`), Mandantenprüfung am
  Schlüssel, Prüfung von Bucket und Zugang beim Start. `dist/cli/migrate-storage.js [--dry-run]` zieht
  vorhandene Dateien um (Rücklesen und Vergleich, wiederholbar, Pfade bleiben gleich). Tests gegen moto
  (S3-Nachbau) in der CI.
- **Nachtrag – Baustelle auf dem Handy**: Menüpunkt „Baustelle“ (Recht `site.use`, per Migration für alle Rollen
  mit `customer.read` außer der Buchhaltung). Heute/morgen: eigene Termine mit Adresse und Navigation (Karten-App),
  Notizen, „Hier anfangen“ (Zeiterfassung für diese Baustelle; eine laufende wird beendet), „Erledigt“ (eigener
  Termin, ohne `customer.write`). Der zuletzt geladene Tag liegt auf dem Gerät und erscheint auch ohne Netz. Je
  Projekt ein Verlauf „Fotos & Nachrichten“ zwischen Büro und Baustelle (`ProjectMessage`, Lesestand je Nutzer,
  Zähler ungelesener Nachrichten im Menü); Fotos werden auf dem Handy auf 1920 px verkleinert (Metadaten und GPS
  fallen weg), als Dokument der Art `photo` am Projekt gespeichert und stehen im Verlauf. Ohne Netz gehen
  Nachrichten und Fotos in eine Warteschlange auf dem Gerät und werden übertragen, sobald Netz da ist; eine vom
  Gerät vergebene `clientId` verhindert Doppelte. Im Büro steht derselbe Verlauf auf der Projektseite. Über
  `/site` sind nur Fotos aus Nachrichten abrufbar, keine anderen Dokumente.
- **Nachtrag – Automatisches Ausrollen**: Workflow „Ausrollen“ (`.github/workflows/deploy.yml`) bei einem
  Versions-Tag `v*` oder von Hand: baut Backend- und Frontend-Image, legt sie in ghcr.io ab und startet per SSH
  (fester Server-Fingerabdruck) auf dem Server `ops/deploy.sh <version>`. Das Skript holt den Code der Version,
  lädt die Images, sichert Datenbank und Dokumente (`.deploy/backups`, die letzten 10), startet neu (Migrationen
  beim Start) und prüft über `GET /api/health`, dass die neue Version antwortet (`version` im Health-Check);
  sonst zurück auf die vorige Version mit Hinweis zum Zurückspielen der Sicherung. `ops/deploy.sh --rollback`
  geht von Hand eine Version zurück. Nie zwei Läufe gleichzeitig (Sperre auf dem Server, `concurrency` im
  Workflow). `docker-compose.prod.yml` nutzt fertige Images (`GARTENAI_IMAGE`, `GARTENAI_VERSION`), baut ohne
  sie wie bisher lokal. In der CI: shellcheck für alle Betriebsskripte und ein Test von `ops/deploy.sh` mit
  Attrappen für docker und curl (Ausrollen, Sicherung, kaputte Version, Rollback, fehlende Images).

- **Nachtrag – Prüfung nach dem Ausbau**: Durchsicht von Baustelle, Import, Verträgen, Objektspeicher
  und Ausrollen. Ergebnisse:
  - **Ladezeit:** Die Seiten außer „Mein Tag“, Baustelle und Anmeldung werden erst beim Aufruf geladen
    (Hauptpaket rund 210 KB statt aller Seiten); kurz nach dem Start lädt die App sie im Hintergrund
    vor, damit sie auch ohne Netz aufgehen – auch dort, wo es keinen Service Worker gibt (http im LAN).
  - **Offline-Start (Fehler behoben):** Beim ersten Besuch lädt die Seite ihre Dateien, bevor der
    Service Worker aktiv ist – sie landeten nie im Cache, ohne Netz blieb die App leer, bis sie einmal
    mit Netz neu geöffnet wurde. Jetzt trägt der Build alle Dateien in den Service Worker ein
    (`vite.config.ts`), er speichert sie bei der Installation; Cache-Name nach Inhalt. Neuer Test mit
    dem fertigen Build: Server stoppen, App neu öffnen, auch eine vorher nie geöffnete Seite
    (`tests/e2e/pwa-offline.spec.ts`, eigener CI-Schritt).
  - **Plantafel und Team:** Beim schnellen Blättern überschrieb eine späte Antwort die zuletzt gewählte
    Woche bzw. Person – behoben (nur die letzte Anfrage zählt).
  - **Verträge:** Der letzte, am Vertragsende gekürzte Zeitraum wird nach Tagen anteilig berechnet
    (bisher der volle Betrag), in der Position steht „anteilig 15 von 31 Tagen“. Terminzeiten der
    Verträge sind echte Ortszeit; an den Tagen der Zeitumstellung lagen sie vorher eine Stunde daneben.
  - **Sicherheit:** Excel-Dateien (Import, Preisliste) werden vor dem Einlesen auf ihre entpackte Größe
    geprüft (ZIP-Bomben, höchstens 100 MB). Sonst ohne Befund: Rechte je Endpunkt, Mandantentrennung
    bei Import-Sitzungen und Abgleich, Fotos nur als Bildtypen mit `nosniff`, Speicherpfade auf die
    Firma begrenzt (lokal und S3), Ausrollen mit fest hinterlegtem Server-Fingerabdruck.
  - **Aktualisierungen:** Node 22 in CI und Containern, aktuelle GitHub Actions, npm audit ohne Befund.
    Bewusst nicht: NestJS 12, Prisma 7, React 19, ESLint 10 (größere Umbauten ohne Nutzen für jetzt).
  - **Tests:** Die E2E-Tests laufen jetzt auch wiederholt gegen dieselbe Datenbank (eindeutige Namen je
    Lauf, Aufräumen auch bei Fehlern).

- **Nachtrag – Offenes KI-Gateway**: Einstellungen → KI-Anbieter (Recht `system.settings.write`): beliebig
  viele Anbieter je Firma, einer als Standard. Arten: OpenAI-kompatibel (Ollama, LM Studio, vLLM, LocalAI,
  OpenRouter, OpenAI …; Adresse bis `/v1`), Anthropic, eigener Agent (POST mit Aufgabe, Frage, Kontext und
  wer fragt; HMAC-Signatur über Zeitstempel und Inhalt; Antwort `{ text, data? }`). API-Schlüssel mit
  AES-256-GCM verschlüsselt (`SECRET_KEY`, sonst aus `JWT_SECRET` abgeleitet), nie wieder ausgegeben.
  Testen-Knopf, Frage an den Standard-Anbieter. Nutzen (`POST /ai/gateway/complete`, Recht `ai.use`):
  Kontext zusätzlich nach Rechten gefiltert (Einkaufspreise, Margen, Löhne), jeder Aufruf im Audit-Log
  (Quelle „ai“, auch Fehler; die Antwort selbst nicht). Adressen im eigenen Netz erlaubt, Metadaten-Dienste
  gesperrt, keine Weiterleitungen; `AI_BLOCK_PRIVATE_NETWORKS=1` sperrt auch private Netze. Anleitung und
  Agentenvertrag: `KI-ANBINDUNG.md`.

- **Nachtrag – Demo-Paket**: `docker-compose.demo.yml` mit Start-, Stopp- und Rücksetz-Skripten für Windows
  und macOS/Linux (`ops/demo`). Ein Laptop ohne Server; Handys im selben WLAN öffnen die App über die
  Adresse des Laptops (QR-Code auf der Anmeldeseite im Demo-Modus, `GET /demo/info` nur mit `DEMO_MODE=1`).
  Beispieldaten über die echte API (`src/cli/demo-data.ts`): Chef, Büro, Mitarbeiter, Kunden, Angebote,
  Aufträge, Rechnungen (bezahlt, überfällig), Pflegevertrag, Termine dieser Woche, Baustellen-Nachrichten.
  Optional HTTPS mit eigener Demo-Zertifizierungsstelle, damit die App auf dem Handy installierbar ist und
  offline läuft. In der CI startet ein Rauchtest die Demo mit HTTPS wie auf einem Laptop. Anleitung:
  `DEMO.md`.

- **Nachtrag – Abwesenheiten**: Urlaub, Krankheit, Schulung oder Sonstiges je Mitarbeiter, ganze Tage
  (Tabelle `Absence`, `GET/POST /absences`, `DELETE /absences/:id`). Eintragen und Löschen mit dem Recht
  `employee.data.read` (im Audit-Log). Die Plantafel zeigt die Tage schraffiert; die Art sieht nur, wer
  Mitarbeiterdaten sehen darf – Krankheit ist ein Gesundheitsdatum –, alle anderen „abwesend“. An diesen
  Tagen lassen sich keine Termine zuteilen (Anlegen und Verschieben), Pflegeverträge lassen den Einsatz
  offen. Beim Eintragen nennt die App die schon zugeteilten Termine im Zeitraum zum Neuverteilen.

- **Nachtrag – Sicherung mit Zurückspiel-Test**: `ops/backup.sh` sichert Datenbank und Dokumente mit
  Prüfsummen (für einen täglichen Cronjob), `ops/restore.sh` spielt eine Sicherung zurück und lehnt
  beschädigte ab. Die CI sichert bei jedem Push, löscht alles samt Volumes, spielt zurück und prüft
  Anmeldung, Daten und Dokumente Byte für Byte (`ops/tests/backup-restore.sh`). Siehe BETRIEB.md.

- **Nachtrag – Push-Nachrichten**: Web Push (Standard, ohne Google/Apple-Konto): Mitarbeiter schalten
  auf der Baustellen-Seite „Benachrichtigungen“ ein (`POST /push/subscribe`, je Gerät, höchstens 10 je
  Nutzer). Nachricht bei einem neu zugeteilten oder verschobenen Termin der nächsten 14 Tage und bei neuen
  Baustellen-Nachrichten an alle, die dort eingeplant sind oder im Verlauf geschrieben haben – nie an den
  Absender. Antippen öffnet die passende Seite. Die Schlüssel des Servers (VAPID) erzeugt GartenAI selbst
  und legt sie verschlüsselt ab; abbestellte Geräte fallen automatisch raus, beim Abmelden meldet die App
  das Gerät ab. Braucht HTTPS; auf dem iPhone ab iOS 16.4 aus der installierten App (BETRIEB.md). Der
  Versand läuft im Hintergrund und bremst keine Aktion.

- **Nachtrag – KI-Aufgaben**: Jeder Anbieter gibt an, was er kann: Text, Bilder verstehen,
  Bilder/Zeichnungen erzeugen. Jede Aufgabe lässt sich einem Anbieter zuordnen, auf Wunsch mit eigenem
  Modell (`AiTaskAssignment`, Einstellungen → KI-Anbieter → Aufgaben). Ohne Zuordnung übernimmt der
  Standard-Anbieter, aber nur, wenn er kann, was die Aufgabe braucht. Die ersten zwei Aufgaben:
  - **Angebotstext entwerfen:** Knopf „Vorschlag der KI“ im Angebotsformular. Mit geht nur, was die
    Aufgabe braucht: Kunde, Objekt, Projekt, Leistungen und Mengen, keine Preise. Das Anschreiben steht
    im PDF über den Positionen und ist nur im Entwurf änderbar.
  - **Baustellen-Verlauf zusammenfassen:** Knopf am Projekt und auf der Baustelle. Die KI bekommt die
    letzten 100 Nachrichten.

  Die Knöpfe erscheinen nur, wenn ein passender Anbieter eingerichtet ist. Eigene Agenten bekommen die
  Aufgabe in `task` und entscheiden selbst, wie sie sie erledigen (z.B. mit Skills). Siehe
  `KI-ANBINDUNG.md`.

- **Nachtrag – KI mit Bildern**: Zwei Aufgaben für Anbieter, die Bilder verstehen:
  - **Beleg lesen** (Eingangsrechnungen, „Mit KI lesen“): Die KI bekommt das Foto oder die ersten zwei
    Seiten der PDF als Bild. Ihre Antwort (JSON oder `data` eines Agenten) wird Feld für Feld geprüft,
    auch die IBAN-Prüfsumme; die eigene IBAN wird verworfen. Das Ergebnis ist ein Vorschlag im
    Formular.
  - **Baustellenfoto beschreiben:** Knopf an jedem Foto in den Baustellen-Nachrichten.

  Die Bilder gehen im Format des jeweiligen Anbieters mit (OpenAI `image_url`, Anthropic
  `image`-Block, Agent `attachments`), höchstens 5 MB je Bild. Das Audit-Log zählt sie, speichert sie
  aber nicht.

- **Nachtrag – Zeichnungs-KI**: Im Lageplan „KI zeichnen“ (Aufgabe `lageplan_zeichnen`, Anbieter
  mit „Bilder/Zeichnungen erzeugen“, z.B. ein eigener Agent).
  - **Auftrag:** in Worten mit Maßen, z.B. „Terrasse 5 × 4 m, daneben Rasen mit Mähkante“.
  - **Ergebnis:** Die KI zeichnet in Metern, GartenAI rechnet in Planeinheiten um und prüft jedes
    Objekt wie beim Speichern. Weil sie Vektor-Objekte zeichnet, stimmen Flächen und Längen, und die
    Mengen gehen ins Angebot.
  - **Speichern:** Der Vorschlag lässt sich rückgängig machen und wird erst mit „Speichern“ gespeichert.
  - **Bild:** Ein eigener Agent darf zusätzlich ein Bild liefern, das man als Hintergrund übernehmen
    kann.
- **Nachtrag – Kalender**: Seite „Kalender“ (Monatsansicht, Wochen ab Montag) mit vier Ebenen, die
  sich einzeln ausblenden lassen:
  - **Firma:** Termine für alle (Betriebsferien, Feiern, Schulungen). Anlegen und ändern darf, wer
    `employee.data.read` hat (Chef, Büro).
  - **Baustellen:** die Einsätze aus der Plantafel, auf Wunsch „nur meine Einsätze“; ein Klick führt
    zum Projekt.
  - **Team:** Abwesenheiten der Mitarbeiter (die Art sieht nur, wer die Personaldaten sehen darf).
  - **Persönlich:** eigene Termine, die nur der Nutzer selbst sieht. Fremde persönliche Termine
    liefern 404.
  - **API:** `GET/POST /calendar/events`, `PUT/DELETE /calendar/events/:id`, Zeitraum höchstens 62 Tage.
    Die Plantafel-Abfrage erlaubt dafür bis zu 42 Tage.

---

## 6. Qualitätssicherung

Jeder Ausbauschritt läuft durch Code-Review (und bei Bedarf Sicherheits-Review), bevor er committet wird; gefundene Fehler werden mit einem Test belegt und behoben. Die CI prüft bei jedem Push Lint, Formatierung, Unit-, Integrations- und E2E-Tests, alle erzeugten E-Rechnungen und PDFs (KoSIT, veraPDF, Mustang), die Alarmregeln und die Produktions-Container.

---

## 7. Offene Punkte

- **Zurückgestellt:** GAEB-Import (braucht echte Beispieldateien), DATEV-Export der Debitoren-Stammdaten (offizielle Formatbeschreibung), Ausrollen auf einen echten Server, Hero-Vergleich.
- **Erledigt am 29.09.2026:** offenes KI-Gateway und Demo-Paket (siehe Nachträge, `KI-ANBINDUNG.md`, `DEMO.md`).
- **Erledigt am 01.10.2026:** Push-Nachrichten für die Baustelle (siehe Nachtrag).
- **Erledigt am 06.10.2026:** Lageplan für die Entwässerung. Aus der Skizze entstehen Einkaufsliste
  und Detailkalkulation:
  - **Formstücke:** Bögen an Ecken (Normwinkel 15/30/45/87°), Abzweig, 87°-Bogen und senkrechtes
    Anschlussrohr an Fallrohren und Gullys, Abzweige bei einmündenden Leitungen, Schachttiefen.
  - **Höhen:** Flächen haben eine Höhe (Standard 0), Leitungen eine Tiefe (Standard 0,50 m).
  - **Neu im Katalog:** Leerrohre, Gebäude und Höhenpunkte, DN 10–1000.
  - **Bedienung:** Objekte lassen sich skalieren; die Mengenliste gibt es als CSV.
  - **Angebot:** Die Formstücke kommen wie alle Mengen ins Angebot, auf Leistungen zugeordnet.
- **Erledigt am 06.10.2026:** Bautagebuch am Projekt und auf der Baustelle. Je Tag gibt es einen
  Eintrag:
  - Wetter und Temperatur
  - Besetzung
  - ausgeführte Arbeiten
  - Verzögerung oder Behinderung mit Stunden, Ursache und Beschreibung
  - Notizen

  Die Fotos des Tages aus den Baustellen-Nachrichten stehen dabei. Einträge in der Zukunft gibt es
  nicht, jede Änderung steht mit altem und neuem Wert im Audit-Log. Dazu kommen die Summe der
  Verzögerungen je Ursache und eine Druckansicht (oder PDF über den Browser).
- **Erledigt am 05.10.2026:** GartenAI im Büro (`BUERO.md`), eine Mini-Vollversion für einen Rechner
  mit echten Daten:
  - Geheimnisse je Installation
  - Ersteinrichtung im Browser mit Einrichtungscode
  - HTTPS mit eigener Zertifizierungsstelle
  - tägliche automatische Sicherung, auch wenn der Rechner nachts aus ist
  - Sofort-Sicherung, Zurückspielen und Update
  - Demo-Daten nur auf Wunsch

  Die CI prüft alles im Rauchtest Büro, einschließlich Zurückspielen.
- **Erledigt am 04.10.2026:** Demo-Agent im Demo-Paket. Er beantwortet alle KI-Aufgaben nach festen
  Regeln, damit sie sich ohne echte KI und ohne Internet vorführen lassen. Die CI prüft ihn im
  Demo-Rauchtest.
- **Erledigt am 04.10.2026:** Zeichnungs-KI für den Lageplan (siehe Nachtrag). Damit sind die drei
  geplanten KI-Schritte umgesetzt: Aufgaben je Anbieter und Modell, Bilder verstehen, Zeichnen.
- **Erledigt am 03.10.2026:** KI mit Bildern: Beleg lesen, Baustellenfoto beschreiben (siehe Nachtrag).
- **Erledigt am 02.10.2026:** KI-Aufgaben mit Zuordnung je Anbieter und Modell, Angebotstext,
  Zusammenfassung der Baustelle (siehe Nachtrag).
- **Erledigt am 30.09.2026:** Abwesenheiten in der Plantafel, Sicherung und Zurückspielen als Skripte mit echtem Test in der CI (siehe Nachträge).
- **Erledigt am 25.09.2026:** Zahlungen auf Mahngebühren und Zinsen, Kontoauszüge als MT940 und CSV, DXF-Import, Aufmaß offline (installierbare App, Lagepläne ohne Netz), OCR-Limit über mehrere Server (siehe Nachtrag unten).
- **Nicht geplant (Entscheidung vom 24.09.2026):** automatischer Kontoabruf per EBICS/FinTS (Auszüge werden als CAMT.053, MT940 oder CSV hochgeladen), Versand der E-Rechnungen über Peppol (Versand per E-Mail mit PDF und XRechnung).
- **Im Betrieb:** Schwellen der Alarmregeln nach einigen Wochen anpassen. Das Backend zeichnet die Werte dafür ab jetzt selbst auf; die Auswertung macht Vorschläge (siehe Nachtrag „Verlauf für die Alarmschwellen“ und BETRIEB.md).
- **Erledigt am 26.09.2026:** Pflege- und Wartungsverträge (Einsätze als Termine, Abrechnung je Zeitraum), Plantafel (siehe Nachträge).
- **Erledigt am 27.09.2026:** Stammdaten-Import aus beliebigen Quellen mit Abgleich, Dokumente im S3-kompatiblen Objektspeicher (siehe Nachträge).
- **Erledigt am 28.09.2026:** Baustelle auf dem Handy (Tagesplan, Zeiten, Fotos, Nachrichten) als Teil der installierbaren App, automatisches Ausrollen auf einen Server (siehe Nachträge).
- **Erledigt (Prüfung nach dem Ausbau):** Seiten werden nachgeladen, die App startet ohne Netz auch beim ersten Mal vollständig, anteilige Abrechnung am Vertragsende, Vertragstermine an den Tagen der Zeitumstellung, Schutz vor ZIP-Bomben, robustere Tests (siehe Nachtrag).
- Bei gescannten PDFs werden höchstens die ersten 10 Seiten per Bild-OCR gelesen.

---

## 8. Nächste sinnvolle Schritte

1. **KI im Alltag erproben:** mit einem echten Anbieter (z.B. Ollama im Büro) Angebotstexte, Belege,
   Fotos und Lagepläne testen und danach die Aufträge an die KI (Prompts) nachschärfen.
2. **Dein Test** mit einem echten Projekt (siehe `TESTANLEITUNG.md`, für einen Server `BETRIEB.md`) – danach mit echten Rückmeldungen weiterplanen.
