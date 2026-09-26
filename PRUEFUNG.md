# Prüfleitfaden

Für eine unabhängige Prüfung von GartenAI durch eine IT-Fachkraft. Das Dokument sagt, wo was steht, wie
man alles selbst aufsetzt und prüft, wo die sicherheits- und datenschutzrelevanten Stellen im Code liegen
und welche Grenzen und offenen Punkte bekannt sind.

Stand: **26.09.2026**. Geprüft wird immer ein bestimmter Stand: `git log -1` zeigt den Commit, die
Ergebnisse aller Prüfungen dazu stehen in GitHub unter „Actions“ bzw. am Pull Request.

---

## 1. Unterlagen

| Datei | Inhalt |
|---|---|
| [`README.md`](README.md) | Funktionsumfang, Architektur, Betriebsarten, Aufbau des Repositorys |
| [`UEBERGABE.md`](UEBERGABE.md) | aktueller Stand, Qualitätssicherung, offene Punkte, nächste Schritte |
| [`DATENMODELL.md`](DATENMODELL.md) | alle Tabellen mit Feldern, Beziehungen, Löschregeln und Mandanten-Schutz (**erzeugt**, per Test aktuell gehalten) |
| [`API.md`](API.md) | alle Schnittstellen mit Anmeldung, nötigem Recht und Limit (**erzeugt**, per Test aktuell gehalten) |
| [`VERFAHRENSDOKUMENTATION.md`](VERFAHRENSDOKUMENTATION.md) | GoBD: Abläufe, Aufbewahrung, internes Kontrollsystem (**Entwurf**) |
| [`STATUS.md`](STATUS.md) | technisches Logbuch: Architektur-Entscheidungen mit Begründung, Nachtrag je Ausbauschritt |
| [`BETRIEB.md`](BETRIEB.md), [`BUERO.md`](BUERO.md), [`DEMO.md`](DEMO.md) | Betrieb auf Server, Einzelplatz, Demo |
| [`KI-ANBINDUNG.md`](KI-ANBINDUNG.md) | KI-Anbieter, Datenfluss, Vertrag für eigene Agenten, Sicherheit |
| [`TESTANLEITUNG.md`](TESTANLEITUNG.md) | Entwicklungsumgebung und Tests |
| [`BEWERTUNG.md`](BEWERTUNG.md) | Ausgangsbewertung vom 22.09.2026 (historisch; zeigt, welche Mängel behoben wurden) |

Die Änderungshistorie liegt in Git: jede Änderung als Pull Request mit Beschreibung und CI-Ergebnis.

---

## 2. Prüfumgebung aufsetzen

**Mit Docker, ohne Entwicklungswerkzeuge** (am schnellsten, Demo-Daten mit festen Passwörtern):

```bash
ops/demo/start.sh            # Windows: ops\demo\start.cmd
# http://localhost:8080, admin@musterbetrieb.de / demo12345
```

**Wie im echten Betrieb:** Einzelplatz nach [`BUERO.md`](BUERO.md) (`ops/buero/start.sh`, eigene Geheimnisse,
HTTPS mit eigener CA, Ersteinrichtung mit Code) oder Server nach [`BETRIEB.md`](BETRIEB.md)
(`docker-compose.prod.yml`).

**Für die Prüfung des Codes:** Entwicklungsumgebung nach [`TESTANLEITUNG.md`](TESTANLEITUNG.md):
PostgreSQL per `docker compose up -d`, dann Backend und Frontend mit Node.js 22.

---

## 3. Alle Prüfungen selbst ausführen

| Prüfung | Befehl | CI-Job |
|---|---|---|
| Lint, Formatierung, Typen | `cd backend && npm run lint && npm run format:check && npx tsc --noEmit`; dasselbe in `frontend` | `backend`, `frontend` |
| Unit-Tests | `cd backend && npm test`, `cd frontend && npm test` | `backend`, `frontend` |
| Schwachstellen in Abhängigkeiten | `npm audit --omit=dev --audit-level=high` (blockierend), `npm audit` (Info) | `backend`, `frontend` |
| Schema = Migrationen | nach `npx prisma migrate deploy`: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` | `backend-integration` |
| Integrationstests (echte PostgreSQL, HTTP, Mandantentrennung) | `cd backend && npm run test:integration` (Datenbank siehe `TESTANLEITUNG.md`) | `backend-integration` |
| E-Rechnungen und PDF/A | KoSIT-Validator, veraPDF, Mustang (`backend/scripts/validate-*.sh`) | `backend-integration` |
| Browser-Tests (Playwright) | `cd frontend && npm run test:e2e` | `e2e` |
| Produktions-Container, Sicherung/Zurückspielen, Demo, Cloud-Sicherung, Einzelplatz inkl. Umzug auf den Server | `bash ops/smoke-test.sh`, `bash ops/tests/backup-restore.sh`, `bash ops/tests/demo-smoke.sh`, `bash ops/tests/cloud-sync.test.sh`, `bash ops/tests/buero-smoke.sh` | `docker` |
| Ausrollen per SSH auf eine frische VM, Update, Rückfall | `bash ops/tests/server-probe.sh` | `server-probe` |
| Windows-Startskripte (PowerShell 5.1, cmd.exe) | `powershell -File ops\tests\windows-buero.test.ps1` | `windows` |
| Alarmregeln (Prometheus) | `promtool check rules` / `test rules` in `ops/prometheus` | `backend` |

Die CI-Definitionen stehen in `.github/workflows/`. Jede Änderung wird erst nach grüner CI übernommen.

---

## 4. Sicherheit – Umsetzung und Fundstellen

Tests: Unit-Tests in `backend/test/` und neben dem Code (`*.spec.ts`), Integrationstests in
`backend/test/integration/` (`*.int-spec.ts`), Browser-Tests in `frontend/tests/`.

| Thema | Umsetzung | Code | Test |
|---|---|---|---|
| Passwörter | bcrypt (Kostenfaktor 12), mindestens 10 Zeichen | `backend/src/auth/passwords.ts` | `users.int-spec.ts` |
| Sitzung | JWT im httpOnly-Cookie (`SameSite=Lax`, `Secure` im Betrieb); ungültig nach Abmelden, Passwortwechsel, Deaktivieren (Token-Version) | `backend/src/auth/session-cookie.ts`, `jwt.strategy.ts` | `session-cookie.int-spec.ts` |
| CSRF | ändernde Anfragen mit Cookie brauchen `X-Requested-With`; Bearer-Token hat Vorrang | `backend/src/auth/session-cookie.ts` | `session-cookie.int-spec.ts` |
| Anmeldesperre | 5 Versuche/Minute je Konto und IP, 30/Minute je IP; `TRUST_PROXY` für die echte Adresse | `backend/src/auth/login-throttle.ts` | `login-rate-limit.int-spec.ts` |
| Anfrage-Limit | je Nutzer, anonym je IP | `backend/src/common/user-throttler.guard.ts` | `rate-limit.int-spec.ts` |
| Rechte | `@RequirePermissions` je Schnittstelle, Prüfung im `PermissionsGuard`; vollständige Liste in [`API.md`](API.md) | `backend/src/common/permissions*.ts` | `permissions-guard.*.spec.ts`, E2E `rollen.spec.ts` |
| Preise | Felder ohne Preisrecht werden aus Antworten entfernt | `backend/src/common/price-visibility.ts` | `price-visibility.spec.ts`, `machines-price-visibility.spec.ts` |
| Mandantentrennung | 1) Filter über `companyId` in jedem Service, 2) Prisma-Guard lehnt Abfragen ohne Firmenfilter ab, 3) Datenbank-Trigger `tenant_guard` gegen Verknüpfungen über Firmengrenzen | `backend/src/prisma/tenant-guard.ts`, Migration `20260923080000_tenant_guard` | `tenant-isolation.int-spec.ts`, `tenant-guard.int-spec.ts` |
| Eingaben | globale Validierung, unbekannte Felder werden abgelehnt (`whitelist`, `forbidNonWhitelisted`) | `backend/src/configure-app.ts` | – |
| HTTP-Header, CORS | `helmet`, CORS nur für eingestellte Frontends | `backend/src/configure-app.ts` | – (kein eigener Test) |
| Uploads | Größenlimits je Schnittstelle (5–20 MB), Schutz vor ZIP-Bomben (XLSX/DOCX), Dateien je Firma getrennt, kein Pfad aus der Anfrage | `backend/src/common/zip-guard.ts`, `documents/` | `zip-guard.spec.ts`, `tenant-isolation.int-spec.ts` (manipulierter `storagePath`) |
| Geheimnisse in der Datenbank | KI-Schlüssel, Push-Schlüssel mit AES-256-GCM (`SECRET_KEY`) | `backend/src/common/secret-box.ts` | `secret-box.spec.ts` |
| Ausgehende KI-Aufrufe | nur `http(s)`, optional Sperre privater Netze (`AI_BLOCK_PRIVATE_NETWORKS`), Zeitlimit, Größenlimit, jeder Aufruf im Audit-Log, Kontext nach Rechten gefiltert | `backend/src/ai-gateway/` | `ai-gateway.int-spec.ts` |
| Anmelden mit Google/OIDC | PKCE, State, Nonce; nur angelegte Nutzer, optional Domain-Liste | `backend/src/auth/oidc*.ts` | `oidc.spec.ts`, `oidc-login.int-spec.ts` |
| Ersteinrichtung | nur mit `SETUP_CODE`, nur solange es keinen Nutzer gibt, gesperrt per Datenbank-Lock | `backend/src/setup/` | `first-setup.int-spec.ts`, Rauchtest Büro |
| Protokoll | Audit-Log für Status-, Rechte- und Datenänderungen mit Nutzer und Zeitpunkt | `backend/src/common/audit.ts` | `audit.int-spec.ts`, `audit-log.int-spec.ts` |
| Logs | je Anfrage eine Zeile, ohne Bodies, Cookies oder Tokens | `backend/src/logging/` | `logging.spec.ts` |
| Belege (GoBD) | Rechnungen ab Ausstellung unveränderlich, Nummern lückenlos je Jahr, Datum in Nummernreihenfolge; PDF und E-Rechnung archiviert mit SHA-256, Archiv per Trigger unveränderlich; Eingangsrechnungen nur offen löschbar (protokolliert), ihre Belegdatei nie einzeln | `backend/src/invoices/`, `common/numbering.ts`, `finance/payables/`, `documents/` | `invoices.int-spec.ts`, `concurrency.int-spec.ts`, `payables.int-spec.ts` |

**Ohne Anmeldung erreichbar** sind nur (Liste in [`API.md`](API.md)):
- `/health`: nur Lebenszeichen und Version.
- `/auth/login`, `/auth/logout` und die OIDC-Anmeldung.
- `/setup/status` und `/setup`: nur mit Einrichtungscode, nur ohne vorhandene Nutzer.
- `/metrics`: nur mit `METRICS_TOKEN`, ohne Token 404.
- `/demo/info`: nur mit `DEMO_MODE=1`, sonst 404.

---

## 5. Datenschutz

**Personenbezogene Daten** (Tabellen siehe [`DATENMODELL.md`](DATENMODELL.md)):

| Daten | Tabellen | Hinweis |
|---|---|---|
| Kunden: Name, Anschrift, E-Mail, Telefon, USt-IdNr. | `Customer`, `Property` | für Angebote, Rechnungen, E-Rechnung |
| Nutzer: Name, E-Mail, Passwort-Hash | `User` | Deaktivieren oder Anonymisieren statt Löschen |
| Mitarbeiter, Arbeitszeiten, Überstunden | `Employee`, `TimeEntry` | nur mit Recht `employee.data.read`; jeder sieht seine eigenen Zeiten |
| Abwesenheiten (auch Krankheit) | `Absence` | ohne `employee.data.read` nur „abwesend“, **ohne Art und Notiz** |
| Baustellen-Nachrichten und Fotos, Bautagebuch | `ProjectMessage`, `Document`, `SiteDiaryEntry` | am Projekt; Dateien im Volume bzw. S3 |
| Bankumsätze (Name, IBAN der Gegenseite) | `BankTransaction` | nur mit Finanzrecht |
| Protokoll (wer hat wann was geändert) | `AuditLog` | nur mit `audit.read` |
| Geräte für Push-Nachrichten | `PushSubscription` | Abbestellen (`DELETE /push/subscribe`) entfernt das Gerät |

**Empfänger außerhalb der Installation** (alle nur, wenn eingerichtet):
- **KI-Anbieter:** Prompts mit Projektdaten. Selbst gehostete Modelle wie Ollama sind möglich, siehe
  [`KI-ANBINDUNG.md`](KI-ANBINDUNG.md).
- **SMTP-Postfach:** Rechnungsversand.
- **Google/OIDC-Anbieter:** Anmeldung.
- **Push-Dienste der Browserhersteller:** Die Inhalte sind verschlüsselt (Web Push).
- **Cloud-Speicher für Sicherungen:** Die Daten werden vor dem Hochladen auf dem Rechner verschlüsselt.
- **S3-Objektspeicher:** für Dokumente.

**Auskunft und Anonymisieren** (`backend/src/privacy/`, Test `privacy.int-spec.ts`, Browser-Test in
`customers.spec.ts`). Gelöscht wird nicht: Rechnungen, Zahlungen, Zeiten und Protokoll müssen
aufbewahrt werden und hängen an diesen Datensätzen.

| Aktion | Schnittstelle, Recht | Was passiert |
|---|---|---|
| Auskunft Kunde (Art. 15) | `GET /customers/:id/export`, `customer.read` + `data.export` | JSON mit Kunde, Objekten, Projekten, Verträgen, Angeboten, Rechnungen (mit Zahlungen, Mahnungen), Dokumentliste, Nachrichten |
| Kunde anonymisieren (Art. 17) | `POST /customers/:id/anonymize`, `customer.delete` | Name → „Anonymisiert …“, Kontakt, Anschrift, USt-IdNr., Leitweg-ID und Anschriften der Objekte leer. Nicht bei offenen Rechnungen oder laufendem Pflegevertrag. Ausgestellte Rechnungen behalten ihre Anschrift (`buyerSnapshot`, Beleg). |
| Auskunft Nutzer/Mitarbeiter | `GET /users/:id/export`, `system.settings.write` | JSON mit Profil (ohne Passwort-Hash), Rollen, Zeiten, Abwesenheiten, Terminen, Kalender, Nachrichten, Geräten, eigenen Aktionen im Protokoll |
| Nutzer anonymisieren | `POST /users/:id/anonymize`, `system.settings.write`, nicht sich selbst | Name und E-Mail ersetzt, zufälliges Passwort, deaktiviert, alle Sitzungen ungültig, Mitarbeiterprofil umbenannt, Push-Geräte gelöscht, Notizen an Abwesenheiten leer. Danach nicht wieder aktivierbar. Zeiten bleiben (Lohnunterlagen). |

Bei beiden Anonymisierungen werden in älteren Protokolleinträgen des Datensatzes die Werte
personenbezogener Felder durch `[anonymisiert]` ersetzt; wer wann was geändert hat, bleibt. Die
Anonymisierung selbst wird protokolliert (`customer_anonymize`, `user_anonymize`). Zeitpunkt in
`anonymizedAt`.

**Bekannte Lücken:**
- **Freie Texte** (Projekttitel, Notizen, Baustellen-Nachrichten, Bautagebuch, Fotos und Dokumente)
  werden nicht automatisch durchsucht. Die Auskunft listet sie; Angaben zu Personen darin sind von
  Hand zu prüfen.
- **Sicherungen** enthalten die Daten bis zum Ablauf ihrer Aufbewahrung weiter (Server: die letzten 14 Sicherungen,
  siehe `BETRIEB.md`). Nach dem Zurückspielen einer älteren Sicherung ist die Anonymisierung zu wiederholen.
- **Löschfristen** sind nicht automatisiert; nach Ablauf der Aufbewahrung (Rechnungen 10 Jahre)
  anonymisieren oder löschen von Hand.
- Kunden aus Bankumsätzen (Name, IBAN der Gegenseite in `BankTransaction`) werden nicht mit anonymisiert
  (Buchungsbeleg).
- Ein **Verzeichnis der Verarbeitungstätigkeiten** und Verträge zur Auftragsverarbeitung (KI, Mail,
  Cloud) sind Aufgabe des Betriebs, nicht der Software.

---

## 6. Betrieb, Sicherung, Wiederherstellung

- **Sicherung:** Datenbank (`pg_dump`) und Dokumente mit Prüfsummen.
  - Server: `ops/backup.sh`, vor jedem Ausrollen automatisch.
  - Einzelplatz: täglich automatisch.
- **Zurückspielen:** `ops/restore.sh` prüft zuerst die Prüfsummen. Getestet mit gelöschten Volumes,
  Byte für Byte.
- **Ausrollen:** `ops/deploy.sh` sichert, startet die neue Version, prüft sie und fällt sonst auf die
  vorige zurück. Getestet auf einer VM.
- **Datenbank-Migrationen:** laufen beim Start. Das Backend startet nicht, wenn eine fehlschlägt.
- **Überwachung:** `GET /metrics` (Prometheus) mit Alarmregeln in `ops/prometheus`, Logs als JSON.

---

## 7. Abhängigkeiten und Images

- **npm-Pakete:** Versionen fest über `package-lock.json`. `npm audit` läuft in der CI und blockiert ab
  „high“ bei den Produktionsabhängigkeiten.
- **Container-Images:**
  - Basis: `node:22-bookworm-slim`, `nginxinc/nginx-unprivileged:1.27-alpine`, `postgres:16`,
    `caddy:2-alpine`, `rclone/rclone:1`.
  - Nur mit Hauptversion angegeben. Updates kommen beim Neubau (`update.sh`/Ausrollen) mit.
  - `cloudflare/cloudflared:latest` (nur optionaler Tunnel) ist nicht fest angegeben.
- **Geheimnisse:** stehen in `.env.production` bzw. `.env.buero` auf dem Rechner, nie im Repository.
  Unter macOS/Linux setzt `start.sh` die Dateirechte auf den Besitzer; unter Windows gelten die Rechte
  des Ordners. Der private Schlüssel der Einzelplatz-CA liegt in `ops/buero/certs`.

---

## 8. Bekannte Grenzen und offene Punkte

Vollständig in [`UEBERGABE.md`](UEBERGABE.md), Abschnitt 8. Prüfrelevant sind vor allem:
- **Datenschutz:** Auskunft und Anonymisieren gibt es; freie Texte, Sicherungen und Löschfristen bleiben Handarbeit (Abschnitt 5).
- **Handtests:** Noch nicht mit echten Nutzern, echtem Büro-PC, Handy, Mail, Cloud und Google geprüft.
- **Datenmenge:** Keine Last- und Penetrationstests über die automatischen Prüfungen hinaus.
- **Server:** Bisher nur auf einer Test-VM betrieben, nicht bei einem Anbieter.

---

## 9. Checkliste für die Prüfung

- [ ] Stand festhalten (`git log -1`), CI-Ergebnis dieses Stands in GitHub ansehen.
- [ ] Umgebung nach Abschnitt 2 aufsetzen, Demo durchklicken.
- [ ] Prüfungen aus Abschnitt 3 selbst ausführen (mindestens Unit, Integration, E2E).
- [ ] [`API.md`](API.md): Schnittstellen ohne Anmeldung und ohne Recht bewerten; Stichproben im Code.
- [ ] Mandantentrennung: `tenant-isolation.int-spec.ts` lesen, eigene Versuche mit zwei Firmen.
- [ ] Rollen: als Mitarbeiter und Buchhaltung anmelden, Preise und Finanzen prüfen.
- [ ] Sicherheitsfundstellen aus Abschnitt 4 lesen.
- [ ] Datenschutz nach Abschnitt 5 bewerten (Verzeichnis der Verarbeitung, Auftragsverarbeitung bei KI/Mail/Cloud).
- [ ] Sicherung und Zurückspielen einmal selbst durchführen (`BETRIEB.md` bzw. `BUERO.md`).
- [ ] Ergebnisse und Befunde festhalten; offene Punkte gegen Abschnitt 8 abgleichen.
