# GartenAI – Bewertung des Gesamtstands

Stand: 22.09.2026 · Branch `claude/galaai-repo-review-2yitns` · ✅ erledigt, 🔶 teilweise erledigt

Grundlage: der gesamte Code (Prisma-Schema mit 23 Modellen, alle Services und Controller, Tests, Frontend) sowie echte Läufe gegen PostgreSQL 16 und Chromium (113 Unit-Tests und 12 E2E-Tests grün, 1 E2E-Test bewusst übersprungen).

---

## Kurzfassung

Die technische Grundlage ist ordentlich. Als Geschäftssoftware für einen Garten- und Landschaftsbaubetrieb ist GartenAI aber **noch nicht einsetzbar**. Das liegt weniger an der Qualität des vorhandenen Codes als daran, was fehlt. Und die bisherige Arbeitsweise hat Fehler verdeckt statt sie zu finden.

---

## 1. Was gut ist

- **Saubere Modulstruktur:** Jedes Modul folgt demselben Aufbau: Controller mit Guards und Rechteprüfung → Service mit Firmenprüfung → Prisma.
- **Preise werden serverseitig geschützt:** Wer keine Einkaufspreise sehen darf, bekommt die Felder gar nicht erst geschickt. Sie werden nicht nur in der Oberfläche versteckt.
- **Angebotspreise werden eingefroren:** Spätere Preisänderungen verändern ein bestehendes Angebot nicht mehr.
- **Kalkulation ist sauber getrennt:** Die Berechnung ist eine eigene, testbare Funktion, getrennt vom Datenbankzugriff.
- **Austauschbare Dienste:** KI-Anbieter, Dateispeicher und OCR lassen sich per Schnittstelle wechseln.
- **Zeiterfassung ist sicher gedacht:** Jeder bucht nur auf das eigene Mitarbeiterprofil, nie auf eine im Request übergebene ID.
- **Strikte Eingabeprüfung:** Unbekannte Felder werden global abgelehnt (`whitelist` + `forbidNonWhitelisted`).

---

## 2. Grundlegende Probleme

### 2.1 Die Kernfunktionen eines Handwerksbetriebs fehlen, selbst im Konzept

| Fehlt | Folge |
|---|---|
| **Rechnungen** (Abschlagsrechnung, Schlussrechnung, Gutschrift) 🔶 | Das Ziel jedes Auftrags ist die Rechnung. Rechnungen stehen nicht einmal in der Roadmap (`GartenAI-Architektur-v1.md`). Dazu kommt die E-Rechnungspflicht (XRechnung/ZUGFeRD), die für Betriebe ab 2027/28 greift. **Stand:** Abschlags-, Schluss- und Stornorechnungen mit lückenlosen Nummern, Pflichtangaben-Prüfung und Unveränderlichkeit per Datenbank-Trigger. Offen: PDF und E-Rechnung. |
| **Umsatzsteuer, Angebotsnummern, Angebots-PDF** 🔶 | Ein Angebot lässt sich weder verschicken noch rechtssicher nummerieren. **Stand:** fortlaufende Nummern und Umsatzsteuer (Standardsatz je Firma) erledigt; PDF offen. |
| **Benutzerverwaltung** ✅ | Es gibt keinen Endpunkt zum Anlegen von Nutzern oder zum Ändern und Zurücksetzen von Passwörtern. Nutzer entstehen nur über das Demo-Seed. **Stand:** Nutzer anlegen, deaktivieren, Passwort ändern und neu setzen – im Backend und in den Einstellungen. |
| **Bearbeiten** ✅ | Es gibt nur 6 PATCH-/DELETE-Routen, fast ausschließlich für Statuswechsel und Rollen. Kunden, Artikel und Projekte lassen sich nicht korrigieren, ein vergessenes „Stopp“ in der Zeiterfassung ebenso wenig. **Stand:** PATCH für Kunden, Objekte, Projekte, Artikel, Maschinen, Lieferanten, Dienstleistungen und Zeiteinträge (Korrektur mit Begründung). Die Oberfläche dafür fehlt noch größtenteils. |
| **Seitenweises Laden** ✅ | Keine einzige Liste lädt seitenweise, jede lädt immer alle Einträge. **Stand:** `take`/`skip` mit Obergrenze und `X-Total-Count`; Kunden- und Projektliste mit „Weitere laden“. |

Die bisherige Entwicklung hat in die Breite gebaut (OCR, KI-Gateway, Datenwächter), bevor ein einziger Ablauf vom Angebot bis zur Rechnung wirklich benutzbar war.

### 2.2 Die Trennung der Firmen hängt an Joins über mehrere Tabellen

`Project`, `Quote`, `Order`, `Appointment` und `TimeEntry` haben keine eigene `companyId`. Jede Abfrage muss sich über Projekt → Objekt → Kunde → Firma hangeln. Das funktioniert, solange niemand es einmal vergisst. Ein einziger vergessener Join ist ein Datenleck zwischen Firmen, wie beim Dokument-Download, der fremde Dateien ausliefern konnte.

**Empfehlung:** `companyId` direkt in diese Tabellen schreiben und die Prüfung zentral erzwingen, zum Beispiel per Prisma-Extension oder Postgres Row-Level-Security. Das hilft nebenbei auch der Geschwindigkeit, denn `Project.propertyId` hat derzeit nicht einmal einen Index.

**Stand:** `companyId` und die fehlenden Indizes sind ergänzt, alle Services filtern direkt darüber. Die zentrale Erzwingung steht noch aus.

### 2.3 Die Tests haben ein falsches Bild vom Zustand gegeben

Die `STATUS.md` meldete „111 Tests grün“, obwohl das Backend sich gar nicht bauen ließ (fehlende Relation `ServiceComponent → Article`). Der Grund: Die Tests laufen gegen nachgebaute Prisma-Objekte ohne echte Datenbank, und der Prisma-Client wurde nie erzeugt. Die Doku beschreibt ausführlich, was geprüft wurde, aber die entscheidende Prüfung fehlte.

**Empfehlung:** Integrationstests gegen eine echte PostgreSQL in der CI. Dass das in dieser Umgebung geht, ist inzwischen gezeigt.

**Stand:** 25 Integrationstests laufen als eigener CI-Job gegen PostgreSQL, dazu eine Prüfung, dass Schema und Migrationen übereinstimmen.

---

## 3. Inhaltliche Fehler in der Geschäftslogik

Diese Punkte sind im Code gefunden, aber nicht einzeln durch Tests bestätigt.

| Bereich | Problem | Vorschlag |
|---|---|---|
| **Rundung** ✅ | Zwischenwerte (Material, Arbeitszeit, Gemeinkosten) wurden je Schritt auf Cent gerundet, gerechnet wurde mit JavaScript-Kommazahlen. Beispiel: 0,3333 × 1,99 € Material je m² ergab 0,91 €/m² statt 0,92 €/m², bei 1.000 m² also 10 € zu wenig. | Behoben: `Prisma.Decimal`, kaufmännische Rundung nur der Ausgabewerte; der Einzelpreis bleibt auf Cent gerundet, damit Einzelpreis × Menge = Positionsbetrag |
| **Maschinen** ✅ | Maschinen haben einen Stundensatz, fließen aber in keine Berechnung ein. Das ist im GaLaBau (Bagger, Rüttler) ein wesentlicher Kostenblock. | Behoben: Maschine mit Minuten je Einheit als Rezeptur-Bestandteil |
| **Nachkalkulation** ✅ | Der Soll-Wert kommt aus der aktuellen Rezeptur statt aus dem eingefrorenen Angebot. Der Soll-Ist-Vergleich verschiebt sich, sobald jemand eine Rezeptur ändert. | Behoben: Soll-Werte werden am Angebot eingefroren |
| **Zeitzonen** ✅ | Tagesgrenzen für „Mein Tag“, Überstunden und Terminkollisionen berechnet der Server mit seiner eigenen Zeitzone (`setHours(0)`). In Docker ist das UTC. Termine zwischen 0 und 2 Uhr deutscher Zeit landen am falschen Tag, und die Uhrzeiten in Fehlermeldungen sind in UTC. | Zeitzone `Europe/Berlin` pro Firma, Tagesgrenzen explizit berechnen |
| **Gleichzeitige Zugriffe** ✅ | Mehrere Prüfungen lesen erst und schreiben dann getrennt. Bei zwei fast gleichzeitigen Anfragen kann es zwei laufende Zeiterfassungen geben, zwei sich überschneidende Termine oder doppelte Statuswechsel beim Angebot. | Behoben: Transaktionssperre pro Mitarbeiter, bedingte Updates; Parallel-Tests in der CI |
| **Auftragsstatus** ✅ | Ein Auftrag kann beliebig springen, etwa von „erledigt“ zurück auf „offen“. Statuswerte sind freier Text. | Behoben: Prisma-Enums und feste Übergänge |
| **Personenmodell** | Termine werden einem `User` zugewiesen, Zeiten einem `Employee`. Ein Mitarbeiter ohne Login kann keine Termine bekommen. | Einheitlich auf `Employee` planen |
| **Nachvollziehbarkeit** 🔶 | Das Audit-Log wird nur beim Datenwächter und beim KI-Gateway geschrieben. Wer eine Arbeitszeit freigegeben hat, wird nicht gespeichert. | Teilweise: Preisänderungen, Zeitkorrekturen und Freigaben (mit Nutzer) werden protokolliert; Status- und Rechteänderungen noch nicht |
| **Preislisten-Import** ✅ | Er läuft ohne Transaktion und mit einer Abfrage pro Zeile. Bricht er mittendrin ab, ist die Preisliste halb importiert. | Behoben: eine Transaktion, doppelte Artikelnummern ergeben 400 |

---

## 4. Sicherheit und Betrieb

- ✅ **Login-Limit in der Praxis:** Die 5 Logins pro Minute zählen pro IP. Ein Trupp von 10 Leuten im selben Büro-WLAN, oder alle Nutzer hinter einem Reverse-Proxy ohne `trust proxy`, sperrt sich morgens gegenseitig aus. Besser: nach E-Mail plus IP zählen. **Stand:** 5/Minute je Konto und IP plus 30/Minute je IP, `TRUST_PROXY` konfigurierbar.
- ✅ **`xlsx` bei hochgeladenen Dateien:** Die Bibliothek hat eine bekannte, ungefixte Prototype-Pollution-Lücke und verarbeitet ausgerechnet Dateien von Nutzern. Besser `exceljs` oder die gepflegte SheetJS-Version vom Hersteller-CDN. **Stand:** ersetzt durch `read-excel-file` (keine bekannten Lücken); `.xls` wird mit klarer Meldung abgelehnt.
- ✅ **`bcrypt` 5.x:** zieht eine kritisch verwundbare `tar`-Version nach. Update auf `bcrypt` 6 oder Wechsel zu `bcryptjs`. **Stand:** `bcrypt` 6. Übrig bleiben Funde in NestJS 10 selbst (multer, body-parser) sowie React Router 6 und Vite 5 im Frontend – alle nur mit einem Major-Upgrade behebbar.
- 🔶 **Token-Handhabung:**
  - ✅ War: deaktivierte Nutzer und entzogene Rechte blieben bis zu 8 Stunden wirksam. Jetzt werden Rechte und „aktiv“ pro Anfrage live geprüft, Passwortänderung und Deaktivierung melden sofort ab.
  - ✅ War: das Frontend reagierte nicht auf 401. Jetzt geht es mit Hinweis zur Login-Seite.
  - Offen: das Token liegt weiterhin im `localStorage` (bei einer XSS-Lücke auslesbar); ein httpOnly-Cookie wäre robuster.
- **Kein Logging:** Es gibt kein strukturiertes Logging und kein Monitoring. (Echte Migrationen sind inzwischen angelegt ✅.)
- **OCR im Server-Prozess:** Die Texterkennung läuft direkt im API-Prozess. Einige große Scans gleichzeitig blockieren dann den ganzen Server. Das gehört in eine Hintergrund-Warteschlange.

Bereits behoben (Commits auf dem Branch):

- Dokument-Download konnte über einen manipulierten `storagePath` beliebige Serverdateien und Dateien anderer Firmen liefern.
- Fester Fallback-Wert für `JWT_SECRET`, mit dem jeder eigene Tokens signieren konnte.
- `backend/.env` wurde vom Backend nie geladen; `JWT_SECRET`, `CORS_ORIGIN` und `UPLOADS_DIR` aus der Datei hatten keine Wirkung.

---

## 5. Empfohlene Reihenfolge

| Schritt | Inhalt |
|---|---|
| **1. Fundament** ✅ | echte Migrationen · Integrationstests gegen PostgreSQL in der CI · `companyId` in allen Tabellen · Enums statt Status-Texte · exakte Dezimalrechnung · Zeitzone `Europe/Berlin` explizit. Noch offen: zentrale Erzwingung der Mandantentrennung (z.B. Row-Level-Security) |
| **2. Benutzbarkeit** 🔶 | Benutzerverwaltung mit Passwort-Reset · Bearbeiten und Archivieren für alle Stammdaten · Korrektur von Zeiteinträgen mit Audit-Log · seitenweises Laden · 401-Behandlung im Frontend. **Stand:** alles außer den Bearbeiten-Masken im Frontend erledigt |
| **3. Kernablauf schließen** 🔶 | Angebotsnummer · Umsatzsteuer · Angebots-PDF · **Rechnungen** (Abschlag und Schluss) mit Blick auf die E-Rechnung. **Stand:** alles außer PDF und E-Rechnung erledigt |
| **4. Kalkulation vervollständigen** ✅ | Maschinen · Rundung pro Gesamtposition · Nachkalkulation auf Basis des eingefrorenen Angebots |
| **5. Erst danach ausbauen** | Mobile App mit Offline-Sync · KI · Schnittstellen (DATEV, GAEB, DATANORM) |

Den Bereich OCR, KI und Datenwächter würde ich einfrieren, bis Schritt 3 steht. Er ist gut gebaut, bringt einem Betrieb aber nichts, solange er keine Rechnung schreiben kann.
