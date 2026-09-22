# GartenAI – Architektur- und Konzeptdokument (Version 1)

Kennzeichnung: **MUSS** = für Version 1 erforderlich · **SOLL** = wichtig, aber verschiebbar · **SPÄTER** = bewusst auf später verschoben · **OPTIONAL** = nice-to-have

---

## 1. Systemarchitektur (Überblick)

```
┌─────────────────────────────────────────────────────────┐
│  Clients                                                 │
│  - Web-App (Desktop, responsive)          [MUSS]         │
│  - Mobile App (Offline-fähig, SQLite)     [SOLL]         │
└───────────────┬───────────────────────────────────────┬─┘
                │ HTTPS / REST + WebSocket               │
┌───────────────▼───────────────────────────────────────▼─┐
│  API-Gateway (Auth, Rate-Limit, Mandanten-Routing)  [MUSS]│
└───────────────┬───────────────────────────────────────┬─┘
                │                                        │
┌───────────────▼─────────────┐   ┌────────────────────▼──┐
│  Backend / Geschäftslogik    │   │  AI-Gateway            │
│  (Node.js/NestJS oder        │   │  (Anbieter-abstrahiert)│
│   .NET – siehe Begründung)   │   │  [MUSS – Grundgerüst]  │
│  [MUSS]                      │   └────────────────────┬──┘
└───────────────┬──────────────┘                        │
                │                          ┌─────────────▼──┐
┌───────────────▼──────────────┐           │ KI-Agenten      │
│  Datenzugriffsschicht (ORM)   │           │ (Kunden-,       │
│  [MUSS]                       │           │ Kalkulations-   │
└───────────────┬──────────────┘           │ Agent, …) [SOLL]│
                │                           └─────────────────┘
┌───────────────▼──────────────┐
│  PostgreSQL (zentral)  [MUSS]  │      Weitere Services:
│  Objektspeicher (Dateien) [MUSS]│      - Dokumentenservice [SOLL]
│  SQLite (mobil, offline) [SOLL]│      - Datenwächter [SOLL]
└────────────────────────────────┘      - Importservice [SOLL]
                                          - Benachrichtigungsdienst [SOLL]
                                          - Synchronisationsservice [SOLL]
```

**Technologie-Entscheidung (begründet):**
- **Backend:** Node.js mit NestJS (TypeScript). *Begründung:* stark typisiert, modulares Framework (passt zu geforderter Modulstruktur), großes Ökosystem für OCR/AI-Anbindung, gleiche Sprache wie Frontend möglich. *Alternative:* .NET (auch valide, etwas schwerer für kleine Teams). **[Entscheidung: NestJS]**
- **Frontend Web:** React + TypeScript, Komponentenbibliothek mit klarer Design-Sprache (siehe UI-Konzept). **[MUSS]**
- **Mobile:** React Native (Code-Teilung mit Web-Logik, offline-fähig via SQLite). **[SOLL]**
- **API-Stil:** REST für CRUD, WebSocket für Live-Updates (z. B. Benachrichtigungen, Dashboard). **[MUSS / SOLL]**
- **ORM:** Prisma (PostgreSQL), erleichtert Mandantentrennung über Middleware. **[MUSS]**

---

## 2. Modulübersicht mit Priorisierung

| Modul | Priorität | Phase |
|---|---|---|
| Dashboard | MUSS | 5 |
| Kunden / Objekte / Projekte | MUSS | 6 |
| Benutzer / Rollen / Rechte | MUSS | 4 |
| Stammdaten (Artikel, Dienstleistungen) | MUSS | 7 |
| Kalkulation | MUSS | 8 |
| Angebote / Aufträge | MUSS | 9 |
| Terminplanung ("Mein Tag") | MUSS | 10 |
| Mitarbeiter / Zeiterfassung | SOLL | 11 |
| Dokumente / OCR | SOLL | 12 |
| Datenwächter | SOLL | 13 |
| KI-Gateway / KI-Berater | SOLL | 14 |
| Nachkalkulation | SOLL | 15 |
| Mobile App | SOLL | 16 |
| Rezepturen, Lieferanten, Maschinen | SOLL | 7 |
| Urlaub / Abwesenheiten | SPÄTER | 11 |
| Schnittstellen (DATEV, GAEB, DATANORM) | SPÄTER | 17 |
| Admin-Bereich als eigene App | SPÄTER | 18 |
| 2FA | SPÄTER | 3 |
| Lokale KI-Modelle | OPTIONAL | 14 |

---

## 3. Datenmodell (Version 1 – Kernentitäten)

```
Company (Unternehmen)
 ├─ User (Benutzer)          → Role (Rolle, n:m via UserRole)
 ├─ Customer (Kunde)
 │   └─ Property (Objekt)
 │       └─ Project (Projekt)
 │           ├─ Order (Auftrag)
 │           ├─ Quote (Angebot)
 │           ├─ Appointment (Termin)
 │           ├─ Document (Dokument)
 │           ├─ ProjectService (verwendete Leistung, Menge)
 │           ├─ ProjectMaterialUsage (Materialverbrauch)
 │           ├─ TimeEntry (Arbeitszeit)
 │           └─ PostCalculation (Nachkalkulation: Soll/Ist)
 ├─ Employee (Mitarbeiter, verknüpft mit User optional)
 ├─ Machine (Maschine)
 ├─ Supplier (Lieferant)
 ├─ Article (Artikel/Material)
 ├─ Service (Dienstleistung)
 │   └─ ServiceComponent (Rezeptur-Bestandteil → Article oder Labor/Machine)
 ├─ PriceList (Preisliste, versioniert)
 ├─ AuditLog (Protokoll)
 └─ Notification (Benachrichtigung)
```

**Wichtige Modellierungsentscheidungen:**
- Jede Tabelle trägt `company_id` (Mandantentrennung), serverseitig über Middleware erzwungen, **niemals** nur über Frontend-Filter. **[MUSS]**
- `Quote` (Angebot) speichert Preise als **Snapshot** (eigene Zeilen, keine Live-Referenz auf `Article.price`), damit spätere Preisänderungen alte Angebote nicht verändern (siehe Punkt 21 im Ursprungsdokument). **[MUSS]**
- `Service` (Leistung) und `ServiceComponent` bilden die Rezeptur-Logik ab (1 m² Terrasse = X Schotter + Y Arbeitszeit …). **[MUSS]**
- Dateien (Fotos, Pläne, PDFs) werden **nicht** als DB-Blob gespeichert, sondern in Objektspeicher (z. B. S3-kompatibel/MinIO), die DB hält nur Metadaten + Pfad. **[MUSS]**
- Preisfelder (Einkauf, Verkauf, Marge) sind auf DB-Query-Ebene über Rechte-Checks abgesichert, nicht nur im UI. **[MUSS]**

---

## 4. Rollen-/Rechtestruktur

**Modell:** Rollenbasiert (RBAC) mit granularen Permission-Flags, erweiterbar auf ABAC (attributbasiert) später.

```
Role (frei definierbar, keine Hardcoded-Rollen)
 └─ RolePermission (n:m zu Permission)
       Permission-Beispiele:
       - customer.read / customer.write / customer.delete
       - price.purchase.read (Einkaufspreise)
       - price.sale.read (Verkaufspreise)
       - price.margin.read (Margen)
       - quote.create / quote.approve
       - order.create / invoice.create
       - employee.data.read
       - ai.use / ai.execute_action
       - data.import / data.export
       - masterdata.write
       - system.settings.write
```

- Vordefinierte Rollen (Geschäftsführung, Büro, Bauleitung, Mitarbeiter …) sind **Startvorlagen**, keine feste Struktur. **[MUSS]**
- Jede API-Route prüft Permissions serverseitig (Middleware/Guard), UI blendet nur zusätzlich aus. **[MUSS]**
- Preisrechte sind eigene, feingranulare Permissions (siehe oben), nicht an "Rolle" hartkodiert. **[MUSS]**

---

## 5. API-Struktur (Auszug, REST)

```
/api/v1/auth/login
/api/v1/companies/:id
/api/v1/customers            GET/POST
/api/v1/customers/:id        GET/PATCH/DELETE
/api/v1/customers/:id/properties
/api/v1/properties/:id/projects
/api/v1/projects/:id
/api/v1/projects/:id/quotes
/api/v1/projects/:id/orders
/api/v1/projects/:id/documents
/api/v1/projects/:id/time-entries
/api/v1/articles
/api/v1/services
/api/v1/services/:id/components
/api/v1/calculations           POST (Kalkulation berechnen)
/api/v1/quotes/:id/convert-to-order
/api/v1/ai/advisor/query       POST (KI-Berater, permission-geprüft)
/api/v1/ai/agents/:agent/run
/api/v1/import                 POST (Datei → Vorschau → Bestätigung)
/api/v1/data-guardian/changes  GET (offene Prüfungen)
/api/v1/audit-log
```

- Alle Preisfelder in Responses werden serverseitig gefiltert, abhängig von Permissions des angefragenden Users (kein "Preis im JSON, aber im UI versteckt"). **[MUSS]**
- Konsistente Fehlerformate, Versionierung über `/v1/`. **[MUSS]**

---

## 6. UI-/Navigationskonzept

**Grundstruktur:**
- Linke Navigation: kontextabhängig, zeigt nur Module, für die der Benutzer Rechte hat. **[MUSS]**
- Dashboard = "Was muss ich jetzt tun?" (keine reine Statistik). **[MUSS]**
- Kontextleiste bei geöffnetem Projekt: direkte Aktionen (Angebot erstellen, Termin planen, Foto hinzufügen …). **[SOLL]**
- Mobile Mitarbeiter-Ansicht: eigene, radikal vereinfachte Oberfläche ("Mein Tag" mit großen Buttons: Arbeit starten/beenden, Pause, Foto, Material). **[SOLL]**
- Ein-Personen-Betrieb-Modus: vereinfachte Planungsansicht ohne Kolonnen/Maschinen-Overhead. **[SOLL]**

---

## 7. KI-Architekturkonzept

```
Anwendung → AI-Gateway (anbieter-abstrahiert) → Provider-Adapter
                                                   ├─ Anthropic
                                                   ├─ OpenAI
                                                   ├─ eigener API-Key
                                                   └─ [SPÄTER] lokales Modell
```

- KI-Gateway kapselt Prompt-Bau, Antwortparsing, Logging – Module rufen nie direkt einen KI-Anbieter auf. **[MUSS – Grundgerüst]**
- **Berechtigungsprinzip:** Jede Anfrage an die KI läuft mit dem Permission-Kontext des anfragenden Users; das Backend filtert Daten **vor** dem Prompt-Bau (kein Verlassen auf "die KI wird schon nichts Falsches sagen"). **[MUSS]**
- KI **interpretiert und schlägt vor**, alle Zahlen (Kalkulation, Preise, Mengen) werden von deterministischer Software berechnet, KI erzeugt keine Geschäftszahlen. **[MUSS]**
- Aktionen mit Datenänderung erfordern Bestätigung durch den Benutzer (Confirm-Schritt in der API). **[MUSS]**
- Spezialisierte Agenten (Kalkulations-Agent, Dokument-Agent …) sind eigene, eng begrenzte Module mit definierten Tool-Zugriffen – kein Super-Agent mit Vollzugriff. **[SOLL]**

---

## 8. Dokument-/OCR-Konzept

```
Upload → Dateierkennung → OCR (z. B. Tesseract/Cloud-OCR)
       → Layoutanalyse → Dokumenttyp-Klassifikation
       → Datenextraktion → Normalisierung
       → Stammdaten-Abgleich → Regelanwendung
       → Aktion (automatisch/zur Prüfung) → Protokoll
```

- Dokumenttyp-Erkennung ist **layout-unabhängig** trainiert/konfiguriert, nicht auf feste Beispiel-Layouts programmiert. **[MUSS]**
- Jeder automatische Schritt wird im Audit-Log festgehalten (wer/was/wann/automatisch oder manuell). **[MUSS]**
- Ergebnis landet je nach Konfidenz entweder direkt in den Stammdaten oder in einer Prüf-Warteschlange. **[SOLL]**

---

## 9. Datenwächter-Konzept

- Beobachtet definierte Ereignisquellen (Uploads, Preislisten-Importe, Schnittstellen-Daten). **[SOLL]**
- Erstellt eine **Diff-Zusammenfassung** (z. B. "18 neue Artikel, 4 Preisänderungen, 1 geänderte Einheit"). **[SOLL]**
- Regel-Engine entscheidet: automatisch übernehmen / zur Prüfung vorlegen / ablehnen / teilweise übernehmen. **[SOLL]**
- Jede Entscheidung + jede Änderung wird protokolliert (AuditLog). **[MUSS, sobald Datenwächter aktiv ist]**

---

## 10. Entwicklungs-Roadmap (Phasen, wie vorgegeben)

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Architektur (dieses Dokument) | ✅ in Arbeit |
| 2 | Datenmodell (Prisma-Schema) | als Nächstes |
| 3 | Authentifizierung & Mandanten | offen |
| 4 | Benutzer / Rollen / Rechte | offen |
| 5 | Grundlayout / Navigation | offen |
| 6 | Kunden / Objekte / Projekte | offen |
| 7 | Stammdaten | offen |
| 8 | Kalkulation | offen |
| 9 | Angebote / Aufträge | offen |
| 10 | Planung | offen |
| 11 | Mitarbeiter / Zeiterfassung | offen |
| 12 | Dokumente / OCR | offen |
| 13 | Datenwächter | offen |
| 14 | KI-Gateway / Agenten | offen |
| 15 | Nachkalkulation | offen |
| 16 | Mobile App | offen |
| 17 | Schnittstellen | offen |
| 18 | Admin-Bereich auslagern | offen |

---

## Empfehlung für den nächsten Schritt

Vorschlag: **Phase 2 + 3 zusammen direkt als lauffähigen Code starten** –
- Prisma-Schema (Company, User, Role, Customer, Property, Project als Kern)
- NestJS-Grundgerüst mit Login (JWT) und Mandanten-Middleware
- Erste geschützte Route (`/customers`) mit Permission-Check

Das gibt uns eine echte, lauffähige Basis, auf der jedes weitere Modul aufbaut – statt Demo-Code, der später verworfen wird.
