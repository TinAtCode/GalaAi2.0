# GartenAI – Bewertung des Gesamtstands

Stand: 22.09.2026 · Branch `claude/galaai-repo-review-2yitns`

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
| **Rechnungen** (Abschlagsrechnung, Schlussrechnung, Gutschrift) | Das Ziel jedes Auftrags ist die Rechnung. Rechnungen stehen nicht einmal in der Roadmap (`GartenAI-Architektur-v1.md`). Dazu kommt die E-Rechnungspflicht (XRechnung/ZUGFeRD), die für Betriebe ab 2027/28 greift. |
| **Umsatzsteuer, Angebotsnummern, Angebots-PDF** | Ein Angebot lässt sich weder verschicken noch rechtssicher nummerieren. |
| **Benutzerverwaltung** | Es gibt keinen Endpunkt zum Anlegen von Nutzern oder zum Ändern und Zurücksetzen von Passwörtern. Nutzer entstehen nur über das Demo-Seed. |
| **Bearbeiten** | Es gibt nur 6 PATCH-/DELETE-Routen, fast ausschließlich für Statuswechsel und Rollen. Kunden, Artikel und Projekte lassen sich nicht korrigieren, ein vergessenes „Stopp“ in der Zeiterfassung ebenso wenig. |
| **Seitenweises Laden** | Keine einzige Liste lädt seitenweise, jede lädt immer alle Einträge. |

Die bisherige Entwicklung hat in die Breite gebaut (OCR, KI-Gateway, Datenwächter), bevor ein einziger Ablauf vom Angebot bis zur Rechnung wirklich benutzbar war.

### 2.2 Die Trennung der Firmen hängt an Joins über mehrere Tabellen

`Project`, `Quote`, `Order`, `Appointment` und `TimeEntry` haben keine eigene `companyId`. Jede Abfrage muss sich über Projekt → Objekt → Kunde → Firma hangeln. Das funktioniert, solange niemand es einmal vergisst. Ein einziger vergessener Join ist ein Datenleck zwischen Firmen, wie beim Dokument-Download, der fremde Dateien ausliefern konnte.

**Empfehlung:** `companyId` direkt in diese Tabellen schreiben und die Prüfung zentral erzwingen, zum Beispiel per Prisma-Extension oder Postgres Row-Level-Security. Das hilft nebenbei auch der Geschwindigkeit, denn `Project.propertyId` hat derzeit nicht einmal einen Index.

### 2.3 Die Tests haben ein falsches Bild vom Zustand gegeben

Die `STATUS.md` meldete „111 Tests grün“, obwohl das Backend sich gar nicht bauen ließ (fehlende Relation `ServiceComponent → Article`). Der Grund: Die Tests laufen gegen nachgebaute Prisma-Objekte ohne echte Datenbank, und der Prisma-Client wurde nie erzeugt. Die Doku beschreibt ausführlich, was geprüft wurde, aber die entscheidende Prüfung fehlte.

**Empfehlung:** Integrationstests gegen eine echte PostgreSQL in der CI. Dass das in dieser Umgebung geht, ist inzwischen gezeigt.

---

## 3. Inhaltliche Fehler in der Geschäftslogik

Diese Punkte sind im Code gefunden, aber nicht einzeln durch Tests bestätigt.

| Bereich | Problem | Vorschlag |
|---|---|---|
| **Rundung** | Der Stückpreis wird zuerst auf Cent gerundet und dann mit der Menge multipliziert. Beispiel: 0,3333 Stück × 1,99 € ergeben 0,66 € statt 0,6633 €. Bei 1.000 m² sind das 3,27 € Abweichung pro Position. | Erst am Positionsbetrag runden, exakte Dezimalwerte statt JavaScript-Kommazahlen (`number`) |
| **Maschinen** | Maschinen haben einen Stundensatz, fließen aber in keine Berechnung ein. Das ist im GaLaBau (Bagger, Rüttler) ein wesentlicher Kostenblock. | Maschinenzeit als Bestandteil der Rezeptur |
| **Nachkalkulation** | Der Soll-Wert kommt aus der aktuellen Rezeptur statt aus dem eingefrorenen Angebot. Der Soll-Ist-Vergleich verschiebt sich, sobald jemand eine Rezeptur ändert. | Soll-Werte aus `QuoteLineItem` lesen oder beim Auftrag einfrieren |
| **Zeitzonen** | Tagesgrenzen für „Mein Tag“, Überstunden und Terminkollisionen berechnet der Server mit seiner eigenen Zeitzone (`setHours(0)`). In Docker ist das UTC. Termine zwischen 0 und 2 Uhr deutscher Zeit landen am falschen Tag, und die Uhrzeiten in Fehlermeldungen sind in UTC. | Zeitzone `Europe/Berlin` pro Firma, Tagesgrenzen explizit berechnen |
| **Gleichzeitige Zugriffe** | Mehrere Prüfungen lesen erst und schreiben dann getrennt. Bei zwei fast gleichzeitigen Anfragen kann es zwei laufende Zeiterfassungen geben, zwei sich überschneidende Termine oder doppelte Statuswechsel beim Angebot. | `updateMany` mit Status-Bedingung bzw. eindeutiger Teil-Index |
| **Auftragsstatus** | Ein Auftrag kann beliebig springen, etwa von „erledigt“ zurück auf „offen“. Statuswerte sind freier Text. | Prisma-Enums und feste Übergangsregeln wie beim Angebot |
| **Personenmodell** | Termine werden einem `User` zugewiesen, Zeiten einem `Employee`. Ein Mitarbeiter ohne Login kann keine Termine bekommen. | Einheitlich auf `Employee` planen |
| **Nachvollziehbarkeit** | Das Audit-Log wird nur beim Datenwächter und beim KI-Gateway geschrieben. Wer eine Arbeitszeit freigegeben hat, wird nicht gespeichert. | Audit für Zeiterfassung, Preise, Status und Rechte |
| **Preislisten-Import** | Er läuft ohne Transaktion und mit einer Abfrage pro Zeile. Bricht er mittendrin ab, ist die Preisliste halb importiert. | Eine Transaktion, gesammelte Abfragen |

---

## 4. Sicherheit und Betrieb

- **Login-Limit in der Praxis:** Die 5 Logins pro Minute zählen pro IP. Ein Trupp von 10 Leuten im selben Büro-WLAN, oder alle Nutzer hinter einem Reverse-Proxy ohne `trust proxy`, sperrt sich morgens gegenseitig aus. Besser: nach E-Mail plus IP zählen.
- **`xlsx` bei hochgeladenen Dateien:** Die Bibliothek hat eine bekannte, ungefixte Prototype-Pollution-Lücke und verarbeitet ausgerechnet Dateien von Nutzern. Besser `exceljs` oder die gepflegte SheetJS-Version vom Hersteller-CDN.
- **`bcrypt` 5.x:** zieht eine kritisch verwundbare `tar`-Version nach. Update auf `bcrypt` 6 oder Wechsel zu `bcryptjs`.
- **Token-Handhabung:**
  - Das JWT liegt 8 Stunden im `localStorage`, ohne Refresh und ohne Sperrmöglichkeit. Deaktivierte Nutzer bleiben bis zu 8 Stunden drin.
  - Das Frontend reagiert nicht auf 401: Ist das Token abgelaufen, sieht der Nutzer nur Fehlermeldungen statt der Login-Seite.
- **Kein Logging und keine Migrationen:** Es gibt kein strukturiertes Logging und kein Monitoring. Die CI nutzt `db push` statt echter Migrationen.
- **OCR im Server-Prozess:** Die Texterkennung läuft direkt im API-Prozess. Einige große Scans gleichzeitig blockieren dann den ganzen Server. Das gehört in eine Hintergrund-Warteschlange.

Bereits behoben (Commits auf dem Branch):

- Dokument-Download konnte über einen manipulierten `storagePath` beliebige Serverdateien und Dateien anderer Firmen liefern.
- Fester Fallback-Wert für `JWT_SECRET`, mit dem jeder eigene Tokens signieren konnte.
- `backend/.env` wurde vom Backend nie geladen; `JWT_SECRET`, `CORS_ORIGIN` und `UPLOADS_DIR` aus der Datei hatten keine Wirkung.

---

## 5. Empfohlene Reihenfolge

| Schritt | Inhalt |
|---|---|
| **1. Fundament** | echte Migrationen · Integrationstests gegen PostgreSQL in der CI · `companyId` in allen Tabellen plus zentrale Prüfung · Enums statt Status-Texte · exakte Dezimalrechnung · Zeitzone `Europe/Berlin` explizit |
| **2. Benutzbarkeit** | Benutzerverwaltung mit Passwort-Reset · Bearbeiten und Archivieren für alle Stammdaten · Korrektur von Zeiteinträgen mit Audit-Log · seitenweises Laden · 401-Behandlung im Frontend |
| **3. Kernablauf schließen** | Angebotsnummer · Umsatzsteuer · Angebots-PDF · **Rechnungen** (Abschlag und Schluss) mit Blick auf die E-Rechnung |
| **4. Kalkulation vervollständigen** | Maschinen · Rundung pro Gesamtposition · Nachkalkulation auf Basis des eingefrorenen Angebots |
| **5. Erst danach ausbauen** | Mobile App mit Offline-Sync · KI · Schnittstellen (DATEV, GAEB, DATANORM) |

Den Bereich OCR, KI und Datenwächter würde ich einfrieren, bis Schritt 3 steht. Er ist gut gebaut, bringt einem Betrieb aber nichts, solange er keine Rechnung schreiben kann.
