# Verfahrensdokumentation (Entwurf)

> **Entwurf – mit Steuerberater abstimmen.** Beschreibt, wie gAla (GalaAi 2.0) steuerlich relevante
> Daten erfasst, verarbeitet, aufbewahrt und schützt, im Sinne der GoBD (BMF-Schreiben vom 28.11.2019,
> Rz. 151 ff.). Aufbau nach dem Muster der AWV: allgemeine Beschreibung, Anwender-, technische System-
> und Betriebsdokumentation, internes Kontrollsystem.
>
> Stellen mit **[auszufüllen]** hängen vom Betrieb ab und sind vom Unternehmen zu ergänzen.
> Die technischen Angaben stammen aus dem Code (Stand der jeweiligen Version im Repository); die
> genannten Tests laufen bei jeder Änderung automatisch (`PRUEFUNG.md`).

| | |
|---|---|
| Unternehmen | **[auszufüllen]** |
| Verantwortlich für das Verfahren | **[auszufüllen]** |
| Steuerberater, Buchhaltung | **[auszufüllen]** (Übergabe per DATEV-Export) |
| Betriebsart | **[auszufüllen]** Einzelplatz (`BUERO.md`) oder Server (`BETRIEB.md`) |
| Gültig ab, Version | **[auszufüllen]**, Git-Stand **[auszufüllen]** |

---

## 1. Allgemeine Beschreibung

**Zweck.** gAla ist die Branchensoftware eines Garten- und Landschaftsbaubetriebs. Sie deckt ab:
Kunden, Angebote, Aufträge, Ausgangsrechnungen mit E-Rechnung, Zahlungen, Mahnungen,
Eingangsrechnungen, Kontoauszüge, Zeiterfassung und Dokumente.

**Keine Finanzbuchhaltung.** Gebucht wird beim Steuerberater. gAla ist ein **Vorsystem**: Es erzeugt
die Ausgangsrechnungen (Belege) und übergibt Buchungsstapel und Debitoren im DATEV-Format.

**Steuerlich relevante Daten in gAla:**

| Daten | Tabelle(n) | Rolle |
|---|---|---|
| Ausgangsrechnungen, Abschlags-, Schluss-, Storno- und Vertragsrechnungen | `Invoice`, `InvoiceLineItem` | Beleg (Original) |
| Zahlungseingänge auf Rechnungen | `InvoicePayment` | Grundaufzeichnung |
| Mahnungen, Mahngebühren, Verzugszinsen, Erlasse | `DunningNotice`, `InvoiceChargeWaiver` | Handelsbrief, Forderung |
| Eingangsrechnungen mit Belegdatei (Bild, PDF, E-Rechnung) | `IncomingInvoice`, `Document` | Beleg (Kopie des empfangenen Originals) |
| Kontoauszüge (CAMT.053, MT940, CSV) | `BankTransaction` | Grundaufzeichnung (Kopie) |
| Angebote, Aufträge | `Quote`, `Order` | Handelsbrief (soweit versandt) |
| Arbeitszeiten | `TimeEntry` | Lohnunterlage |
| DATEV-Exporte | nur als Datei; der Export selbst steht im Protokoll | Übergabe |
| Protokoll der Änderungen | `AuditLog` | Nachvollziehbarkeit |

Tabellen und Felder: `DATENMODELL.md`.

---

## 2. Anwenderdokumentation (Abläufe)

### 2.1 Ausgangsrechnungen

1. Eine Rechnung entsteht als **Entwurf** aus einem Auftrag oder aus einem Pflegevertrag. Entwürfe
   sind frei änderbar und löschbar; sie haben noch keine Nummer.
2. Beim **Ausstellen** passiert in einer Transaktion:
   - Die Rechnung erhält die nächste Nummer `R-JJJJ-NNNN`, fortlaufend je Firma und Kalenderjahr
     (`common/numbering.ts`).
   - Das Rechnungsdatum darf nicht in der Zukunft liegen und nicht vor der zuletzt ausgestellten
     Rechnung, damit Nummern und Daten dieselbe Reihenfolge haben.
   - Anschrift von Verkäufer und Käufer werden als Kopie in die Rechnung geschrieben (`sellerSnapshot`,
     `buyerSnapshot`). Spätere Änderungen an Firma oder Kunde ändern die Rechnung nicht.
   - Ein Eintrag `invoice_issue` kommt ins Protokoll.
3. Nach dem Ausstellen ist die Rechnung **unveränderlich**. Das sichert ein Datenbank-Trigger
   (`invoice_guard`, `invoice_line_guard`, Migration `20260922233000_invoices`), auch an der Anwendung
   vorbei:
   - Rechnung und Positionen lassen sich nicht mehr ändern oder löschen.
   - Einzig erlaubt ist der Wechsel von „ausgestellt“ auf „storniert“.
4. **Korrektur nur per Stornorechnung.** Sie hat eine eigene Nummer, negative Beträge und verweist auf
   die Originalrechnung (`invoice_cancel`). Danach kann eine neue Rechnung ausgestellt werden.
5. **Ausgabe:**
   - PDF/A-3b (archivtauglich), geprüft mit veraPDF.
   - E-Rechnung als XRechnung (UBL) bzw. ZUGFeRD (CII im PDF), geprüft mit dem KoSIT-Validator und
     Mustang.
   - Versand per E-Mail (`invoice_send`, mit Empfänger im Protokoll).
   - Das PDF wird bei jedem Abruf aus den unveränderlichen Daten neu erzeugt (siehe 6., offene Punkte).
6. **Steuerliche Behandlung** je Rechnung: Regelsteuersatz, § 19 UStG (Kleinunternehmer) oder
   § 13b UStG (Steuerschuldnerschaft des Leistungsempfängers), mit dem Pflichthinweis auf dem Beleg.

Tests: `invoices.int-spec.ts`, `quote-numbers-vat.int-spec.ts`, `vat-treatment.int-spec.ts`,
`concurrency.int-spec.ts` (keine doppelten Nummern bei gleichzeitigem Ausstellen).

### 2.2 Zahlungen und Mahnungen

- Zahlungen werden von Hand erfasst oder beim Kontoauszug-Import zugeordnet. Die Rechnung selbst
  bleibt unverändert; offen ist der Betrag abzüglich der Zahlungen (`invoice_payment`).
- Eine falsch erfasste Zahlung wird gelöscht und im Protokoll festgehalten (`invoice_payment_delete`).
- Zahlungen werden nach § 367 BGB verrechnet: erst Kosten, dann Zinsen, dann Hauptforderung.
- Mahnungen haben Stufen, Frist, Gebühren und Zinsen (`dunning_create`, `dunning_send`). Ein Erlass
  von Gebühren oder Zinsen wird protokolliert (`invoice_charges_waive`).

### 2.3 Eingangsrechnungen

1. Der Beleg wird hochgeladen: Foto, PDF, XRechnung oder ZUGFeRD. Die Datei wird unverändert
   gespeichert (`Document`).
2. Die Angaben werden erkannt: bei E-Rechnungen exakt aus dem XML, sonst per Texterkennung. Das Büro
   prüft und ergänzt sie.
3. Mögliche Zustände: offen, bezahlt (von Hand oder über den Kontoauszug) oder storniert (wird nicht
   bezahlt).
4. **Aufbewahrung:**
   - Bezahlte und stornierte Eingangsrechnungen lassen sich nicht löschen. Die Belegdatei einer
     Eingangsrechnung lässt sich auch einzeln nicht löschen (Tests in `payables.int-spec.ts`).
   - Nur eine **offene** Eingangsrechnung lässt sich löschen, gedacht für Fehlerfassungen und Doppel.
     Das Löschen wird mit Lieferant, Nummer, Datum, Betrag und Dateiname protokolliert
     (`payable_delete`).
   - Eine bezahlte oder stornierte Rechnung kann erst nach „Wieder öffnen“ gelöscht werden; das
     Wiederöffnen wird nicht protokolliert. Die Regel dazu gehört in die Arbeitsanweisung (Abschnitt 5).

### 2.4 Kontoauszüge

- Auszüge werden als Datei importiert (`bank_import`). Einen automatischen Abruf gibt es bewusst
  nicht.
- Schon eingelesene Umsätze erkennt gAla an einem Schlüssel aus Bankreferenz bzw. Buchungsangaben
  (`dedupeKey`) und übernimmt sie nicht noch einmal.
- Das Original ist der Auszug der Bank (Onlinebanking bzw. Kontoauszug), nicht die Kopie in gAla.

### 2.5 Übergabe an die Buchhaltung (DATEV)

- `GET /datev/bookings?from&to` erzeugt einen **EXTF-Buchungsstapel**:
  - alle ausgestellten und stornierten Ausgangsrechnungen im Zeitraum;
  - wahlweise die Zahlungseingänge.
- `GET /datev/debtors` erzeugt die Debitoren-Stammdaten (Name, Anschrift, Debitorennummer).
- Jeder Export wird mit Zeitraum und Anzahl protokolliert (`datev_export`); dafür ist das Recht
  `data.export` nötig.
- Die Erlöskonten werden je Steuersatz und Behandlung zugeordnet (`datev/revenue-accounts.ts`).
  Kontenrahmen und Konten mit dem Steuerberater abstimmen: **[auszufüllen]** SKR03/SKR04.
- Eingangsrechnungen werden **nicht** an DATEV übergeben. Die Belege gehen auf dem bisherigen Weg an
  den Steuerberater: **[auszufüllen]**, z.B. DATEV Unternehmen online.

### 2.6 Arbeitszeiten

- Zeiten werden erfasst und freigegeben (`time_entry_approve`).
- Nachträgliche Korrekturen stehen im Protokoll, mit altem und neuem Wert und Grund
  (`time_entry_correct`).
- Zeiten bleiben auch nach dem Anonymisieren eines Mitarbeiters erhalten (Datenschutz,
  `PRUEFUNG.md` Abschnitt 5).

---

## 3. Technische Systemdokumentation

- **Aufbau:**
  - React-Oberfläche, NestJS-Backend und PostgreSQL 16, als Docker-Container.
  - Dokumente im Dateisystem-Volume oder in einem S3-kompatiblen Speicher.
  - Architektur: `README.md`; Schnittstellen mit Rechten: `API.md`; Tabellen: `DATENMODELL.md`.
- **Datenbankschema** nur über versionierte Migrationen (`backend/prisma/migrations`). Die CI prüft,
  dass das Schema zu den Migrationen passt.
- **Unveränderlichkeit:**
  - Ausgestellte Rechnungen sind per Datenbank-Trigger geschützt (2.1).
  - Beträge werden exakt als Dezimalzahlen gerechnet, nicht als Gleitkommazahlen.
  - Die Zeitzone ist fest Europe/Berlin.
- **Mandantentrennung:** jede Tabelle mit `companyId`, zusätzlich Datenbank-Trigger `tenant_guard`.
- **Protokoll (`AuditLog`):**
  - Jeder Eintrag enthält Zeitpunkt, Nutzer, Aktion, Datensatz sowie alten und neuen Wert.
  - Einträge entstehen für die in Abschnitt 2 genannten Aktionen; die vollständige Liste liefert
    `grep -rn "action: '" backend/src`.
  - Die Anwendung hat keine Funktion zum Ändern oder Löschen von Protokolleinträgen. Einzige Ausnahme
    ist das Anonymisieren auf Datenschutzanfrage: Dabei werden personenbezogene Werte geschwärzt, die
    Einträge selbst bleiben.
- **Zugriff:**
  - Anmeldung, Rollen und Rechte je Funktion (`API.md`).
  - Rechnungen ausstellen, Finanzen, Export und Protokoll brauchen jeweils eigene Rechte.
- **Versionen:**
  - Jede Änderung am Programm ist im Git-Verlauf mit Datum, Beschreibung und Tests nachvollziehbar.
  - Ausgerollte Versionen: `BETRIEB.md` (Server) bzw. `BUERO.md` (Update).

---

## 4. Betriebsdokumentation

- **Sicherung:**
  - Täglich werden Datenbank und Dokumente mit Prüfsummen gesichert.
  - Server: `ops/backup.sh`, zusätzlich vor jedem Ausrollen. Einzelplatz: Dienst `backup`, auch nach
    dem Einschalten, wenn der Rechner nachts aus war.
  - Behalten werden standardmäßig die letzten 14 Sicherungen.
- **Aufbewahrung über 10 Jahre:** Die rollierenden Sicherungen reichen dafür **nicht**. Zusätzlich:
  **[auszufüllen]**, z.B.:
  - jährlich nach dem Jahresabschluss eine Sicherung auf einen getrennten Datenträger bzw. in den
    verschlüsselten Cloud-Speicher (`ops/buero/cloud-sync.sh`);
  - jährlich den DATEV-Export und die PDFs der Ausgangsrechnungen des Jahres archivieren.
- **Wiederherstellung:**
  - Mit `ops/restore.sh` bzw. `ops/buero/restore.*`.
  - Die CI spielt bei jeder Änderung eine Sicherung zurück und prüft das Ergebnis
    (`backup-restore.sh`, `buero-smoke.sh`).
  - Den Umzug vom Einzelplatz auf einen Server beschreibt `BUERO.md`.
- **Datenzugriff der Finanzverwaltung (§ 147 Abs. 6 AO):**
  - Lesezugriff über eine Rolle mit Leserechten (Z1).
  - Datenüberlassung (Z3) über DATEV-Export, PDF/XML der Rechnungen und auf Anforderung einen
    Datenbankauszug.
  - Das Verfahren dafür: **[auszufüllen]**.
- **Geheimnisse:**
  - Liegen in `.env.production` bzw. `.env.buero` auf dem Rechner, nie im Repository.
  - Den Schlüssel `SECRET_KEY` mit den Sicherungen aufbewahren, sonst sind hinterlegte Zugangsdaten
    nicht wiederherstellbar.

---

## 5. Internes Kontrollsystem

**Technisch erzwungen:**
- Rechnungen sind nach dem Ausstellen unveränderlich; Korrektur nur per Storno.
- Die Nummern laufen fortlaufend und sind in der Reihenfolge der Daten.
- Bezahlte und stornierte Eingangsrechnungen samt Beleg bleiben erhalten.
- Aktionen stehen im Protokoll: Ausstellen, Stornieren, Versand, Zahlungen, Mahnungen, Export,
  Rechte- und Nutzeränderungen, Zeitkorrekturen.
- Rechte werden je Funktion vergeben, und die Firmen sind voneinander getrennt.

**Organisatorisch festzulegen [auszufüllen]:**
- Wer darf Rechnungen ausstellen und stornieren, wer Zahlungen erfassen, wer exportieren? Das ist die
  Zuordnung der Rollen.
- Wann darf eine Eingangsrechnung gelöscht werden? Vorschlag: nur Fehlerfassungen und Doppel am Tag
  der Erfassung, nie nach Übergabe an den Steuerberater.
- Wer prüft wann das Protokoll? Vorschlag: monatlich die Aktionen `invoice_cancel`,
  `invoice_payment_delete`, `payable_delete` und `invoice_charges_waive`.
- In welchem Rhythmus werden DATEV-Exporte übergeben, und wer stimmt Summen mit dem Steuerberater ab?
- Wer ist für Sicherung, Jahresarchiv und Wiederherstellungstest zuständig?

---

## 6. Offene Punkte und Grenzen (für die Abstimmung)

1. **Versandte Rechnung als Datei.**
   - Das PDF wird bei Bedarf neu erzeugt, und zwar inhaltsgleich, weil die Daten unveränderlich sind.
     Ändert sich jedoch das Layout durch ein Programm-Update, sieht ein neu erzeugtes PDF anders aus
     als das versandte.
   - Übergangslösung: Das Postfach behält die gesendeten Mails **[auszufüllen]**.
   - Technisch möglich wäre, PDF und XML beim Ausstellen bzw. Versand als Dokument zu speichern.
2. **Protokoll auf Datenbankebene.** Das Protokoll ist gegen Änderungen durch die Anwendung
   geschützt, aber nicht gegen einen Datenbank-Administrator (kein Trigger, keine Hash-Kette).
   Erreichbar ist die Datenbank nur über den Server bzw. den Einzelplatz-Rechner.
3. **Eingangsrechnungen:**
   - Erfassen, Ändern, Bezahlen, Wiederöffnen und Stornieren werden nicht protokolliert; nur das
     Löschen wird protokolliert.
   - Offene Eingangsrechnungen dürfen gelöscht werden (siehe 2.3).
4. **Jahresarchiv über 10 Jahre:** noch nicht automatisiert (Abschnitt 4).
5. **Kassenbuch** und **Lohnabrechnung** sind nicht Teil von gAla.

Bewertung und Freigabe durch den Steuerberater: **[auszufüllen]**, Datum **[auszufüllen]**.
