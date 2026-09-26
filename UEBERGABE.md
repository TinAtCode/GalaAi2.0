# GartenAI (gAla) – Zustand und Übergabe

Stand: **26.09.2026** · Repository `TinAtCode/GalaAi2.0`, Branch `main`

Dieses Dokument fasst zusammen, was GartenAI heute kann, wie es betrieben und geprüft wird, was offen
ist und wo die Details stehen. Es ersetzt keine der Fachanleitungen, sondern führt zu ihnen hin
(Abschnitt 10). Ändert sich der Stand, dieses Dokument mitpflegen.

---

## 1. Kurzfassung

GartenAI ist ein ERP für Garten- und Landschaftsbaubetriebe. Es deckt den ganzen Ablauf ab:
Kunde → Kalkulation → Angebot → Auftrag → Einsatzplanung → Baustelle → Rechnung → Zahlung, Mahnung,
Buchhaltung.

- **Einsatzbereit** in drei Betriebsarten:
  - Demo für Vorführungen
  - Einzelplatz im Büro mit echten Daten
  - eigener Server
- **Umzug** vom Einzelplatz auf den Server über die Sicherung, siehe Abschnitt 4.
- **Geprüft** bei jedem Push:
  - Unit-, Integrations- und Browser-Tests
  - E-Rechnungs- und PDF-Validierung
  - echte Container-Starts aller Betriebsarten
  - Sicherung und Zurückspielen
  - Server-Ausrollen auf einer VM
  - die Windows-Startskripte auf echtem Windows
- **Noch nicht geschehen:** Test mit echten Nutzern, echtem Büro-PC und echtem Handy.
  Abschnitt 8 nennt die offenen Punkte.

---

## 2. Funktionsumfang

**Vertrieb und Kalkulation**
- Kunden, Objekte (Adressen) und Projekte, mit Projektnummer `P-<Jahr>-<Nr>`.
- Kundenverlauf: Umsatz je Jahr, Annahmequote.
- Stammdaten:
  - Artikel, Leistungen mit Rezepturen (Material, Arbeitszeit, Maschinen)
  - Lieferanten, Maschinen, Einheitenkatalog mit Rundung
- Kalkulation mit einstellbarem Stundensatz, Gemeinkosten und Aufschlag.
- Angebote:
  - Preis-Snapshot, freie Positionen, Nummernkreis
  - Umsatzsteuer, auch § 19 UStG und § 13b UStG
  - PDF, Freigabe, Versand
  - Kopieren (z. B. Pflege vom Vorjahr)
- Aufträge aus angenommenen Angeboten.
- GAEB: Leistungsverzeichnis einlesen (X83), Angebot abgeben (X84).
- Pflege- und Wartungsverträge: Einsätze als Termine, Abrechnung je Zeitraum.

**Planung und Ausführung**
- Einsatzplanung:
  - Plantafel mit Entwurfsmodus („was wäre wenn“), Kalender (Firma, Team, Baustelle, persönlich)
  - Abwesenheiten, „Mein Tag“, Sprachbefehle ohne KI
- Zeiterfassung als Selbstbedienung, Freigabe (auch gesammelt), Korrekturen mit Protokoll, Überstunden.
- Lagepläne:
  - Zeichnen mit Maßstab, DXF-Import
  - Entwässerung mit Formstücken, Höhen und Leerrohren
  - Mengen ins Angebot, offline auf der Baustelle
- Bautagebuch mit Behinderungen, Checklisten mit Vorlagen.
- Geräte und Fahrzeuge: Schäden, Wartung, Inventur.
- Nachkalkulation: Soll aus dem eingefrorenen Angebot gegen das Ist aus Zeiten, Material und
  Eingangsrechnungen, dazu der Deckungsbeitrag.

**Baustelle auf dem Handy** (installierbare Web-App)
- Tagesplan, Zeit stempeln, Fotos, Nachrichten ans Büro, Push-Nachrichten.
- Funktioniert auch ohne Netz; die Daten werden nachgereicht.

**Rechnungen und Finanzen**
- Rechnungen:
  - Abschlags-, Schluss- und Stornorechnung, Pflegevertrags-Rechnung
  - PDF/A, XRechnung, ZUGFeRD, Versand per E-Mail
  - Rechnungsdatum: Nummern und Daten laufen in derselben Reihenfolge (GoBD)
- Zahlungen, offene Posten, Mahnwesen (optional mit Gebühren, Verzugszinsen und Pauschale).
- Bankabgleich mit Kontoauszügen als CAMT.053, MT940 oder CSV.
- Eingangsrechnungen:
  - Belege lesen, dem Projekt zuordnen
  - mit Lieferscheinen abgleichen
- Finanzen:
  - Kontostände, Kategorien mit Regeln, Fixkosten, Jahresüberblick
  - Liquiditätsvorschau, Versicherungen und Verträge mit Kündigungsfristen
- DATEV: Buchungsstapel (EXTF) und Debitoren-Stammdaten.

**Dokumente, Import, KI**
- Dokumente mit Texterkennung (auch gescannte PDFs), wahlweise im S3-Objektspeicher.
- Lieferscheine erkennen und zuordnen, Mail an Lieferanten.
- Import:
  - Stammdaten aus beliebigen Quellen (CSV/XLSX) mit Vorschau und Abgleich
  - Preislisten mit Vorschau
- KI-Gateway, frei wählbar:
  - OpenAI-kompatibel (auch selbst gehostet, z. B. Ollama), Anthropic oder eigener Agent
  - je Aufgabe eigener Anbieter und eigenes Modell
  - Aufgaben: Angebotstext, Baustellen-Zusammenfassung, Beleg lesen, Foto beschreiben,
    Lageplan zeichnen
  - Demo-Agent für Vorführungen ohne Internet

**Verwaltung und Sicherheit**
- Rollen und Rechte (Abschnitt 3), Benutzerverwaltung, Anmelden mit Google/OIDC (optional).
- Audit-Log für Status- und Rechteänderungen und Korrekturen (z. B. Zeiten, Bautagebuch).
- Aufgaben-Übersicht („zu erledigen“), Schnellsuche, Dunkelmodus.
- Erscheinungsbild gAla (Standard) oder GartenAI.

---

## 3. Rollen

| Rolle | Kurz |
|---|---|
| Geschäftsführung (Administrator) | alle Rechte |
| Buchhaltung | Finanzen, Rechnungen, Zahlungen, DATEV, Kunden, Dokumente, Verkaufspreise – keine Einkaufspreise |
| Einsatzplaner | wie Mitarbeiter, dazu Checklisten-Vorlagen verwalten und freigeben |
| Mitarbeiter | Kunden lesen, Pläne lesen, Baustelle, KI – keine Preise, keine Finanzen |

Preise und Margen, die jemand nicht sehen darf, entfernt der Server aus der Antwort. Die Oberfläche
blendet sie nicht nur aus. Rechte sind frei kombinierbar (25 Einzelrechte,
`backend/src/common/permissions.ts`).

---

## 4. Betriebsarten

| | Demo | Einzelplatz (Büro) | Server |
|---|---|---|---|
| Wofür | Vorführung, Laptop + Handys im WLAN | echter Betrieb auf einem Rechner | echter Betrieb, von überall |
| Anleitung | `DEMO.md` | `BUERO.md`, Checkliste `BUERO-TEST.md` | `BETRIEB.md`, Probe `SERVER-TEST.md` |
| Start | `ops/demo/start.*` | `ops/buero/start.*` (Windows: Doppelklick `start.cmd`) | `docker compose -f docker-compose.prod.yml` bzw. `ops/deploy.sh` / Workflow „Ausrollen“ |
| Compose-Datei | `docker-compose.demo.yml` | `docker-compose.buero.yml` | `docker-compose.prod.yml` |
| Adresse | `http://<IP>:8080`, optional HTTPS `:8443` | `https://<IP>:8443` (eigene CA) | hinter eigenem HTTPS-Proxy, intern `:8080` |
| Daten | Musterbetrieb, feste Passwörter | Ersteinrichtung im Browser mit Einrichtungscode | Ersteinrichtung per `setup-company.js` |
| Sicherung | – | täglich automatisch, Sofort-Sicherung, Zurückspielen, optional verschlüsselt in die Cloud | `ops/backup.sh` / `ops/restore.sh`, vor jedem Ausrollen automatisch |

**Voraussetzung** ist Docker bzw. Docker Desktop. Docker Desktop ist für kleine Firmen kostenlos (unter
250 Mitarbeitern und 10 Mio. US-Dollar Umsatz; aktuelle Bedingungen bei Docker prüfen). Podman als
kostenloser Ersatz wird gerade in der CI erprobt (PR #54).

**Einzelplatz → Server:** Im Büro sichern, den Server einrichten und dabei **`SECRET_KEY` aus
`.env.buero` übernehmen**, dann die Sicherung mit `ops/restore.sh` einspielen. Die Schritte stehen in
`BUERO.md`, Abschnitt „Später auf einen Server umziehen“. Die CI spielt diesen Umzug bei jedem Push durch.

**Unterwegs auf den Einzelplatz zugreifen:** Tailscale (privat) oder Cloudflare-Tunnel, siehe `BUERO.md`.

---

## 5. Technik

- **Backend:**
  - NestJS 11 (Express 5), Prisma 5, PostgreSQL 16, TypeScript
  - 66 Datenmodelle, 45 Migrationen, dokumentiert in `DATENMODELL.md`
  - Das Backend wendet die Migrationen beim Start selbst an.
- **Frontend:**
  - React 18, React Router 7, Vite 8, eigenes CSS mit Design-Tokens (kein UI-Framework)
  - installierbare Web-App mit Service Worker
- **Container:** PostgreSQL, Backend, Frontend (nginx leitet `/api` weiter). Im Büro und in der Demo
  kommt Caddy für HTTPS dazu.

Wichtige Entscheidungen, Details in `STATUS.md`, Abschnitt 3:
- **Mandantentrennung:** `companyId` in jeder Mandanten-Tabelle, dazu:
  - Datenbank-Trigger (`tenant_guard`) gegen Verknüpfungen über Firmengrenzen
  - Prisma-Guard, der Listen- und Massenabfragen ohne Firmenfilter ablehnt
- **Geld und Zeit:** Geld wird exakt dezimal gerechnet, die Zeitzone ist fest `Europe/Berlin`.
- **Sitzung:** httpOnly-Cookie mit CSRF-Schutz. Anmeldesperre je Konto und je IP, Anfrage-Limit
  je Nutzer.
- **Geheimnisse:** API-Schlüssel und Push-Schlüssel liegen verschlüsselt in der Datenbank
  (AES-256-GCM, Schlüssel `SECRET_KEY`).
- **Austauschbare Dienste** über Schnittstellen: KI-Anbieter, Dateispeicher (lokal/S3), OCR-Engine.
- **Betrieb:** Logs als JSON, Prometheus-Metriken mit Alarmregeln (`ops/prometheus`).

**Wichtige Einstellungen** (Vorlage `.env.production.example`):

| Variable | Bedeutung |
|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET` | Pflicht |
| `SECRET_KEY` | Schlüssel für gespeicherte Geheimnisse – beim Umzug mitnehmen |
| `TRUST_PROXY`, `COOKIE_SECURE` | Proxy-Anzahl, Cookie nur über HTTPS |
| `SMTP_URL`, `MAIL_FROM` | Mailversand |
| `STORAGE=s3`, `S3_*` | Dokumente im Objektspeicher |
| `OIDC_*` | Anmelden mit Google/OIDC |
| `METRICS_TOKEN` | Metriken freischalten |

Beim Einzelplatz erzeugt `start` alle Geheimnisse in `.env.buero`. **Diese Datei zusammen mit den
Sicherungen aufbewahren.**

---

## 6. Qualitätssicherung

| Prüfung | Umfang (Stand 26.09.2026) |
|---|---|
| Backend Unit-Tests | 322 (davon 6 halten `DATENMODELL.md` und `API.md` aktuell) |
| Backend Integrationstests (echte PostgreSQL, HTTP) | 278 (2 bewusst übersprungen) |
| Frontend Unit-Tests | 28 |
| Browser-Tests (Playwright) | 78 (3 übersprungen): Durchstiche Verkauf und Einkauf bei 1280 und 390 px, Rollen, alle Module |
| Einzelplatz im Browser | 7 Tests: Ersteinrichtung, Rollen, alle 18 Bereiche, Handy offline |

**CI-Jobs** (`.github/workflows`), alle laufen bei jedem Push und PR:

| Job | Prüft |
|---|---|
| `backend`, `frontend` | Lint, Formatierung, Typen, Unit-Tests, Alarmregeln |
| `backend-integration` | Schema passt zu den Migrationen, Integrationstests gegen PostgreSQL, die erzeugten E-Rechnungen (KoSIT) und PDFs (veraPDF, Mustang) |
| `e2e` | Browser-Tests, App ohne Netz mit fertigem Build, Push im Service Worker |
| `docker` | Produktions-Container, Sicherung/Zurückspielen, Demo, Cloud-Sicherung. Dazu der Rauchtest Büro: Einrichtung, Checkliste im Browser mit installiertem Stammzertifikat, Sicherung, Zurückspielen, Beenden/Starten, Docker-Neustart, Update, Umzug auf den Server |
| `server-probe` | Ausrollen per SSH auf einer frischen Ubuntu-VM mit HTTPS, Update, Rückfall |
| `windows` | Windows-Startskripte unter Windows PowerShell 5.1 über `cmd.exe`, Pfad mit Umlauten. Docker ist dort eine Attrappe; echt sind Zertifikate, Zertifikatsspeicher, Firewall und Sicherungsdateien |

**Arbeitsweise:**
- Jede Änderung läuft über einen PR.
- Vor dem Push laufen Lint, Typen sowie die kompletten Unit- und Integrationstests lokal.
- Gemergt wird erst, wenn alle Jobs grün sind.
- Gefundene Fehler werden mit einem Test belegt.

---

## 7. Zuletzt gefundene und behobene Fehler (Auswahl)

- **Einzelplatz:**
  - Der erzeugte `SECRET_KEY` wurde vom Backend abgelehnt, deshalb gingen KI-Schlüssel und Push
    nicht (PR #53).
  - Bei `git clone` unter Windows bekamen die Shell-Skripte CRLF-Zeilenenden und brachen in den
    Containern ab (`.gitattributes`).
  - Als Administrator gestartet, trägt `start.ps1` das Stammzertifikat jetzt ohne Rückfrage ein.
- **Tests:** Die Browser-Tests rechnen jetzt in deutscher Zeit. Nach 22 Uhr UTC lagen Termine
  „heute“ vorher auf dem falschen Tag.
- **Rechnungen:** Ein frei gewähltes Rechnungsdatum darf weder in der Zukunft noch vor der letzten
  ausgestellten Rechnung liegen.
- **Eingangsrechnungen:** Eine stornierte Rechnung gibt ihre Lieferscheine frei und nimmt keine
  neuen mehr an.

---

## 8. Offen

**Entscheidung nötig**
- **Deckungsbeitrag:** Material kann doppelt zählen, wenn es als Verbrauch gebucht ist *und* in einer
  Eingangsrechnung steht. Bisher erscheint nur ein Hinweis in der Nachkalkulation. Vorschlag:
  Eingangsrechnungen mit zugeordneten Lieferscheinen ersetzen den gebuchten Materialverbrauch.

**Laufende PRs** (Stand dieses Dokuments)
- **#54 (Entwurf):** Einzelplatz mit Podman statt Docker. Dabei gefunden und behoben: Die
  Gesundheitsprüfung des Backends stand nur im Dockerfile, Podman übernimmt sie nicht. Jetzt steht sie
  zusätzlich in den Compose-Dateien.

**Handtests, die keine CI ersetzen kann** (Checklisten `BUERO-TEST.md`, `SERVER-TEST.md`)
- Einzelplatz auf einem echten Windows-PC mit Docker Desktop.
- Echtes Handy: Stammzertifikat, App installieren, Kamera, Offline.
- Mailversand über das eigene Postfach, Cloud-Sicherung, Anmelden mit Google.
- Server bei einem Anbieter (SSH-Zugang steht noch aus).
- KI im Alltag mit einem echten Anbieter (z. B. Ollama); danach die Prompts nachschärfen.

**Bekannte Grenzen**
- Gescannte PDFs: Die Texterkennung liest höchstens die ersten 10 Seiten.
- Nachkalkulation: Der Lohn wird zum Kalkulations-Stundensatz bewertet, nicht zu den echten
  Lohnkosten je Mitarbeiter. Der Überstundenzuschlag ist vorbereitet, aber nicht mit der
  Lohnvorbereitung verbunden.
- Der Browser-Test des Mahnwesens nutzt Attrappen: Überfällige Rechnungen lassen sich über die API
  bewusst nicht erzeugen.
- Einzelplatz: eine Firma je Installation. Der Rechner muss laufen, damit Handys zugreifen können.
- NestJS 12 ist noch nicht eingebaut (reines ESM, eigener Umbau).
- Alarmschwellen nach einigen Wochen echtem Betrieb anpassen (`BETRIEB.md`, „Überwachung“).

- Datenschutz: Auskunft und Anonymisieren für Kunden und Nutzer sind da; freie Texte, Sicherungen und Löschfristen bleiben Handarbeit (`PRUEFUNG.md`, Abschnitt 5).
- GoBD: Verfahrensdokumentation als Entwurf, mit dem Steuerberater abzustimmen. Rechnungen werden inzwischen als Datei mit Prüfsumme archiviert, Eingangsrechnungen vollständig protokolliert. Offen ist dort u.a. ein Jahresarchiv über 10 Jahre (`VERFAHRENSDOKUMENTATION.md`, Abschnitt 6).

**Bewusst nicht geplant:** automatischer Kontoabruf (EBICS/FinTS), E-Rechnungs-Versand über Peppol.
**Noch nicht umgesetzt:** DATANORM, Vergleich mit Hero.

---

## 9. Nächste Schritte

1. Die Entscheidung zum Deckungsbeitrag treffen (Abschnitt 8).
2. PR #54 (Podman) abschließen.
3. Echten Test mit einem Projekt fahren: Einzelplatz nach `BUERO-TEST.md` auf dem Büro-PC, Handy im
   WLAN, danach die Rückmeldungen einarbeiten.
4. KI mit einem echten Anbieter erproben.
5. Einen Server bereitstellen und nach `BETRIEB.md` bzw. mit dem Workflow „Ausrollen“ einrichten;
   dann den Umzug vom Einzelplatz durchführen.

---

## 10. Dokumente im Repository

| Datei | Inhalt | Zustand |
|---|---|---|
| `UEBERGABE.md` | dieses Dokument: Gesamtstand und Übergabe | aktuell |
| `README.md` | Einstieg: Funktionsumfang, Architektur, Betriebsarten, Repository | aktuell |
| `API.md` | alle Schnittstellen mit Anmeldung, Recht und Limit | aus dem Code erzeugt, von einem Test aktuell gehalten |
| `PRUEFUNG.md` | Prüfleitfaden: Prüfumgebung, alle Prüfungen, Sicherheit mit Fundstellen, Datenschutz, Checkliste | aktuell |
| `VERFAHRENSDOKUMENTATION.md` | GoBD: Abläufe, Unveränderlichkeit, Aufbewahrung, internes Kontrollsystem | Entwurf, mit Steuerberater abstimmen |
| `DATENMODELL.md` | alle Tabellen mit Feldern, Beziehungen, Löschregeln, Mandanten-Schutz, ER-Diagrammen | aus dem Schema erzeugt, von einem Test aktuell gehalten |
| `BUERO.md` | Einzelplatz einrichten, sichern, unterwegs, Mails, Google, Update, Umzug | aktuell |
| `BUERO-TEST.md` | Checkliste Einzelplatz (Handtest), mit Hinweis auf die automatischen Punkte | aktuell |
| `BETRIEB.md` | Server: Start, HTTPS, Google, Push, Sicherung, S3, Ausrollen, OCR, Überwachung | aktuell |
| `SERVER-TEST.md` | Server auf einer VM am eigenen Rechner ausprobieren | aktuell |
| `DEMO.md` | Vorführung mit Laptop und Handys | aktuell |
| `KI-ANBINDUNG.md` | KI-Anbieter, Aufgaben, eigener Agent (Schnittstellenvertrag) | aktuell |
| `TESTANLEITUNG.md` | Entwicklungsumgebung, Ablauf von Hand, E2E-Tests | aktuell |
| `STATUS.md` | technisches Logbuch: Architektur-Entscheidungen und Nachträge je Ausbauschritt | Nachschlagewerk; der Gesamtstand steht hier |
| `BEWERTUNG.md` | Ausgangsbewertung vom 22.09.2026 und Fahrplan | historisch, alle Punkte umgesetzt |
| `GartenAI-Architektur-v1.md` | ursprüngliches Konzept (Module, Datenmodell, Roadmap) | historisch |
| `brand/README.md` | Logo und Markendateien | aktuell |
