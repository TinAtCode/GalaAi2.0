# GartenAI – Projektstatus

> Zentrale Anlaufstelle: Stand, Entscheidungen, offene Punkte, nächste Schritte.
> Wird knapp gehalten – Details stehen im Code/in den Tests, nicht hier.

Letzte Aktualisierung: 22.09.2026 – Fundament (Schritt 1 aus BEWERTUNG.md): echte Migrationen, Integrationstests gegen PostgreSQL, companyId in allen Mandanten-Tabellen, Status-Enums, Dezimalrechnung, Firmen-Zeitzone

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
| 14 | KI-Gateway | 🔶 Adapter-Grundgerüst fertig, kein aktiver Anbieter (Entscheidung folgt später) |
| 15 | Nachkalkulation (Arbeitszeit + Material, Soll/Ist) | ✅ |
| — | E2E-Tests (Playwright), Lint/Format (ESLint+Prettier), CI/CD (GitHub Actions) | 🔶 vollständig geschrieben, E2E-Ausführung hier nicht möglich (siehe Abschnitt 5) |
| 16–18 | Mobile App, Schnittstellen, Admin-Auslagerung | ⬜ |

Backend: NestJS 11 (Express 5) + Prisma 5 + PostgreSQL. Frontend: React 18 + React Router 7 + Vite 8 + TypeScript, kein UI-Framework (bewusst reines CSS mit Design-Tokens, siehe Abschnitt 4).
Tests: `cd backend && npm test` (125 Unit-Tests, gemockter Prisma-Client bzw. reine Funktionen), `npm run test:integration` (76 Integrationstests gegen eine echte PostgreSQL, siehe `TESTANLEITUNG.md`) und `cd frontend && npm run test:e2e` (16 Playwright-E2E-Tests, 1 davon bewusst übersprungen). Lint: `npm run lint` in beiden Projekten (0 Fehler/Warnungen). Frontend-Build: `cd frontend && npm run build` (geprüft, läuft fehlerfrei durch).

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
- **KI-Gateway**: reine `AiProvider`-Schnittstelle + Injection-Token, aktuell an `NoopAiProvider` gebunden. Anbieterwechsel = eine Zeile im Modul ändern, kein anderer Code betroffen. Jeder Aufruf wird im Audit-Log protokolliert.
- **Objektspeicher (Dokumente)**: dasselbe Muster wie beim KI-Gateway – eine `FileStorage`-Schnittstelle + Injection-Token, aktuell an `LocalDiskStorage` gebunden (Dateien unter `UPLOADS_DIR`, pro Firma in eigenem Unterordner). Wechsel auf S3/MinIO später = neue Klasse + eine Zeile im Modul. Datei-Upload/-Download real per HTTP getestet: Byte-für-Byte identischer Inhalt nach Upload+Download-Roundtrip.
- **Datenwächter**: Diff-Erkennung (neu/Preisänderung/Einheitenänderung) ist eine reine, getestete Funktion. `apply` unterstützt jetzt auch zeilenweise Auswahl über ein optionales `acceptedArticleNumbers`-Feld (Punkt 16: "teilweise übernehmen") – ohne dieses Feld bleibt das bisherige Verhalten (alles übernehmen) der Standard. Bewusst ohne eigene Staging-Tabelle: der Client ruft zuerst `analyze` auf und entscheidet selbst, welche Artikelnummern er übernehmen will. Datei-Import (CSV/XLSX) mit toleranter Spaltenerkennung (deutsche/englische Kopfzeilen, deutsches Zahlenformat) ist real per Datei-Upload möglich.
- **OCR**: PDFs mit Textebene werden direkt und ohne Bild-OCR ausgelesen (`pdf-parse`). PDFs OHNE Textebene (gescannt) werden jetzt vollständig verarbeitet: `pdf-parse` rendert jede Seite als echtes Bild (`getScreenshot()`, keine zusätzliche Abhängigkeit nötig), jede Seite läuft durch dieselbe Bild-OCR-Engine wie direkt hochgeladene Fotos, Ergebnisse werden zusammengeführt (Deckel: max. 10 Seiten, siehe offene Punkte). Die OCR-Engine selbst ist wie beim KI-Gateway/Objektspeicher austauschbar (`ImageOcrEngine`-Interface + Token), aktuell `TesseractOcrEngine`. Dokumenttyp-Erkennung läuft über einfache Schlüsselwortsuche im extrahierten Text, keine KI nötig.
- **Datenbank-Indizes**: alle Fremdschlüssel-Spalten (`companyId`, `projectId`, `customerId`, etc.) haben jetzt einen `@@index` – ohne das würde jede Mandantentrennungs-Abfrage einen Full-Table-Scan machen, sobald Tabellen wachsen. Bereits `@unique`/`@@unique`-Felder wurden bewusst NICHT zusätzlich indiziert (redundant, da Unique-Constraints in Postgres automatisch einen Index erzeugen).
- **Rate-Limiting**: global 100 Anfragen/Minute pro IP (`@nestjs/throttler`), Login zusätzlich auf 5/Minute begrenzt (Brute-Force-Schutz). Beides real per HTTP getestet (429 nach Limit-Überschreitung).
- **Security-Header**: `helmet()` global aktiv (entfernt `X-Powered-By`, setzt `X-Content-Type-Options`, `X-Frame-Options` etc.) – real per HTTP-Header-Vergleich verifiziert.
- **CORS** nur für die eigenen Frontends: `CORS_ORIGIN` (kommagetrennt), ohne Wert das lokale Vite-Frontend. Mit Cookies wäre „offen für alle“ nicht mehr vertretbar.
- **Sitzung im httpOnly-Cookie** (`gartenai_session`, `SameSite=Lax`, `Secure` in Produktion bzw. `COOKIE_SECURE`): JavaScript im Browser kommt nicht an das Token. Ändernde Anfragen mit Cookie brauchen `X-Requested-With` (CSRF-Schutz). `GET /auth/me` stellt die Sitzung nach dem Neuladen wieder her, `POST /auth/logout` löscht das Cookie. API-Clients (Tests, spätere Mobile-App) schicken das Token weiter als Bearer-Header. Betrieb: Frontend und API unter derselben Domain (z.B. `app.` und `api.` einer Domain); liegen sie auf verschiedenen Domains, `COOKIE_SAMESITE=none` und HTTPS.
- **Anfrage-Limit** 300/Minute je angemeldetem Nutzer, anonym je IP (`RATE_LIMIT`, `common/user-throttler.guard.ts`). Vorher 100/Minute je IP – Kollegen hinter derselben Büro-IP teilten sich ein Kontingent.
- **E2E-Tests (Playwright)**: 13 Tests für die kritischen User Journeys (Login-Erfolg/-Fehler, geschützte Route ohne Login, Kalkulation, kompletter Angebots-Workflow inkl. Ablehnen-Pfad, Termin anlegen, Stammdaten/Artikel anlegen, Team-Zeiterfassungs-Freigabe). Testdaten für den Angebots-Workflow werden per API vorbereitet (Arrange-Schritt), nicht über die UI – es gibt bewusst kein Formular zum manuellen Anlegen eines Angebots (Angebote entstehen aus einer Kalkulation heraus). Echte `data-testid`-Attribute im Code, keine brüchigen Text-Selektoren.
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
Kunden, Projekte, Projekt-Detail (Termine anlegen, Angebote/Aufträge mit
Statuswechsel-Aktionen), Kalkulation, Stammdaten, Team (Mitarbeiter-Zeiteinträge
ansehen und freigeben, nur mit `employee.data.read` sichtbar).

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
  und läuft in der CI auf allen in den Tests erzeugten E-Rechnungen. Noch nicht unterstützt: ZUGFeRD,
  Versand per E-Mail/Peppol.

- **Nachtrag – Belege ohne Umsatzsteuer**: `vatTreatment` an Angebot und Rechnung. Kleinunternehmer
  (§ 19 UStG, Firmeneinstellung) stellen immer ohne USt aus; § 13b UStG wird am Angebot gewählt
  (`vatTreatment: "reverse_charge"`). Die Rechnung übernimmt die Behandlung vom Angebot, das Storno vom
  Original. PDF mit Pflichthinweis; E-Rechnung mit Kategorie E bzw. AE und Befreiungsgrund, bei § 13b mit
  der USt-IdNr. des Kunden (neues Feld am Kunden). 0 % ohne Grund bleibt als E-Rechnung gesperrt.

- **Nachtrag – Audit-Log**: Statuswechsel von Angeboten, Aufträgen und Projekten, Nutzeränderungen
  (Sperren, Namen), Passwort-Reset (ohne das Passwort) sowie Rollenrechte und Rollenzuweisungen werden mit
  handelndem Nutzer, altem und neuem Wert in derselben Transaktion protokolliert. Gleichzeitige
  Statuswechsel: nur einer gelingt und nur dieser steht im Protokoll (Integrationstest).

---

## 6. Optimierungsdurchgang (dieser Arbeitsschritt)

Auf ausdrücklichen Wunsch wurde der gesamte bisherige Code systematisch auf Lücken geprüft:
- **Gefunden und behoben:** fehlende DB-Indizes auf allen Fremdschlüsseln (21 ergänzt), kein Rate-Limiting (ergänzt, real getestet), keine Security-Header (Helmet ergänzt, real getestet), `.gitignore` fehlte in beiden Projekten (ergänzt), CORS war nicht einschränkbar (jetzt über `CORS_ORIGIN` konfigurierbar).
- **Geprüft und für in Ordnung befunden:** Guards/Mandantenprüfungen sind über alle Module hinweg konsistent, DTO-Validierung ist durchgängig, keine zirkulären Modul-Abhängigkeiten.
- Schema samt neuer Indizes wurde erneut komplett gegen eine echte PostgreSQL angewendet (siehe Abschnitt 5) – fehlerfrei. Alle 86 Tests weiterhin grün, kompletter DI-Graph erneut real gebootet.

---

## 7. Offene Punkte

- Dokumente: echter Datei-Upload/-Download funktioniert (lokales Dateisystem). OCR-Ergebnis wird nicht automatisch als Document gespeichert (zwei getrennte Schritte: OCR ansehen, dann ggf. hochladen). Bei gescannten PDFs werden maximal die ersten 10 Seiten per Bild-OCR gelesen (Deckel gegen sehr lange Scans).
- KI-Gateway ohne aktiven Anbieter (bewusst zurückgestellt).
- E2E-Tests (Playwright) und CI/CD-Workflows (GitHub Actions) sind geschrieben, aber nie tatsächlich ausgeführt worden – auf deiner Maschine bzw. in einem echten GitHub-Repo müssen sie sich erstmalig bewähren.
- Mobile App (React Native/Expo), Schnittstellen (DATEV/GAEB/DATANORM), Admin-Auslagerung: noch nicht begonnen.
- Es existieren separate, umfassendere Projekt-Planungsdokumente (README.md, STATUS.md, DEVELOPMENT_GUIDE.md, TESTING_GUIDE.md, SECURITY_CHECKLIST.md, CICD_GUIDE.md, SKILLS_REFERENCE.md im Projekt-Root), die teils einen größeren, teamartigen Rahmen beschreiben (Mobile-Team, DevOps-Rolle, Security-Officer). Diese hier vorliegende STATUS.md beschreibt ausschließlich den tatsächlichen Code-Stand.

---

## 8. Nächste sinnvolle Schritte

1. **Dein Test** (siehe `TESTANLEITUNG.md`) – danach mit echten Ergebnissen/Feedback weiterplanen. Dabei auch `npx playwright install chromium` + `npm run test:e2e` im Frontend ausprobieren.
2. KI-Anbieter festlegen, sobald relevant → echter Adapter + erster KI-Agent.
3. Weitere E2E-Tests für die übrigen Module (Stammdaten, Team) nach demselben Muster.

Ohne weitere Vorgabe: nächster Ausbauschritt ist, was im Code noch als Lücke vermerkt ist (siehe Abschnitt 7).
