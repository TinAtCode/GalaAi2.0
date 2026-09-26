# Schnittstellen (API)

> **Erzeugt** aus den Controllern (`backend/src/**/*.controller.ts`) – nicht von Hand ändern.
> Neu erzeugen: `cd backend && npm run docs:api`. Der Unit-Test `api-doc.spec.ts` schlägt fehl, wenn
> diese Datei nicht zum Code passt.

263 Schnittstellen in 50 Controllern. Im Betrieb liegen sie unter `/api`
(nginx leitet `/api/…` an das Backend weiter), z.B. `GET /api/customers`.

## So wird der Zugriff geprüft

1. **Anmeldung** (`JwtAuthGuard`, `src/auth/jwt-auth.guard.ts`): Sitzung im httpOnly-Cookie oder
   Bearer-Token. Ändernde Anfragen mit Cookie brauchen zusätzlich `X-Requested-With` (CSRF-Schutz).
   Ein Token gilt nur, solange die Token-Version des Nutzers passt (Abmelden, Passwortwechsel,
   Deaktivieren machen alte Sitzungen ungültig).
2. **Recht** (`PermissionsGuard`, `src/common/permissions.guard.ts`): Alle unter „Recht“ genannten
   Rechte sind nötig. Die Rechte hängen an den Rollen des Nutzers (`DATENMODELL.md`).
3. **Firma:** Jeder Service filtert mit der `companyId` des angemeldeten Nutzers; fremde IDs
   ergeben 404. Zusätzlich Datenbank-Trigger und Prisma-Guard (siehe `README.md`, Architektur).
4. **Feinere Regeln im Service**, z.B. Preise ohne Preisrecht werden aus der Antwort entfernt, eigene
   Zeiten nur für das eigene Mitarbeiterprofil, Rechnungen nach dem Ausstellen unveränderlich.
5. **Anfrage-Limit** global je Nutzer bzw. IP (`RATE_LIMIT`); Anmeldung zusätzlich je Konto und IP.
   Abweichende Limits stehen in der Spalte „Limit“.

## Ohne Anmeldung erreichbar

Diese Schnittstellen prüfen keine Sitzung; was sie schützt, steht im Hinweis bzw. im Code.

| Methode | Pfad | Limit | Hinweis | Datei |
|---|---|---|---|---|
| POST | `/auth/login` | loginIpLimit je 60 s | Login ist das klassische Brute-Force-Ziel: 5 Versuche/Minute je Konto und IP (Throttler "login-account", app.module.ts) plus 30/Minute je IP über alle Konten hinweg (hier). Details in auth/login-throttle.ts. Der Browser bekommt die Sitzung als httpOnly-Cookie; das Token in der Antwort ist für API-Clients (Tests, spätere Mobile-App). | `src/auth/auth.controller.ts` |
| POST | `/auth/logout` |  |  | `src/auth/auth.controller.ts` |
| GET | `/auth/oidc` |  | Anmelden mit Google (oder einem anderen OIDC-Anbieter). Die Login-Seite fragt, ob es eingerichtet ist, und zeigt dann den Knopf. | `src/auth/auth.controller.ts` |
| GET | `/auth/oidc/start` | loginIpLimit je 60 s | Der Browser springt hierher und wird zum Anbieter weitergeleitet. State, Nonce und PKCE-Schlüssel liegen signiert in einem kurzlebigen Cookie. | `src/auth/auth.controller.ts` |
| GET | `/auth/oidc/callback` | loginIpLimit je 60 s | Rücksprung vom Anbieter: Code eintauschen, Konto anmelden, zurück ins Frontend | `src/auth/auth.controller.ts` |
| GET | `/demo/info` |  | Nur in der Demo (DEMO_MODE=1, docker-compose.demo.yml): Adressen im LAN für den QR-Code und die Demo-Anmeldungen für die Anmeldeseite. Sonst 404 – im Betrieb gibt es diese Daten nicht. | `src/demo/demo.controller.ts` |
| GET | `/health` |  | Bewusst OHNE Guards: für Monitoring/Load-Balancer/CI-Healthchecks, die sich nicht einloggen können. Liefert absichtlich keine Geschäftsdaten, nur ein Lebenszeichen. | `src/health/health.controller.ts` |
| GET | `/metrics` | ohne Limit | Für Prometheus: ohne Login, aber nur mit METRICS_TOKEN als Bearer-Token. Ohne eingestelltes Token ist der Endpunkt aus (404) – Metriken verraten Auslastung und Routen und gehören nicht ins offene Internet. | `src/metrics/metrics.controller.ts` |
| GET | `/metrics/history` | ohne Limit | Auswertung des Verlaufs mit Vorschlägen für die Alarmschwellen (?days=28, ?format=text für den lesbaren Bericht) | `src/metrics/metrics.controller.ts` |
| GET | `/setup/status` |  | ohne Anmeldung: nur solange es keinen Nutzer gibt (siehe SetupService) | `src/setup/setup.controller.ts` |
| POST | `/setup` |  | ohne Anmeldung: nur solange es keinen Nutzer gibt (siehe SetupService) | `src/setup/setup.controller.ts` |

## Angemeldet, ohne besonderes Recht

Jeder angemeldete Nutzer der Firma; Einschränkungen (z.B. nur eigene Daten) im Service.

| Methode | Pfad | Hinweis |
|---|---|---|
| GET | `/ai/gateway/status` |  |
| GET | `/appointments/my-day` | Keine zusätzliche Permission: jeder eingeloggte User darf seinen eigenen Tag sehen. |
| GET | `/articles` | Lesen ist grundsätzlich jedem eingeloggten User erlaubt (Name/Einheit werden z.B. für die Kalkulation benötigt) – die Preisfelder selbst werden aber pro User anhand seiner Rechte aus- oder eingeblendet. |
| GET | `/articles/:id` |  |
| GET | `/auth/me` | Die angemeldete Person – das Frontend stellt damit nach dem Neuladen die Sitzung aus dem Cookie wieder her. |
| POST | `/auth/change-password` | Eigenes Passwort ändern. Meldet alle anderen Sitzungen ab und gibt für dieses Gerät ein neues Token zurück. |
| POST | `/calculations` | Keine zusätzliche @RequirePermissions hier: JEDER eingeloggte User darf eine Kalkulation anstoßen, aber WELCHE Felder er im Ergebnis sieht, hängt von seinen Preisrechten ab (maskCalculationResult). |
| GET | `/calendar/events` |  |
| POST | `/calendar/events` |  |
| PUT | `/calendar/events/:id` |  |
| DELETE | `/calendar/events/:id` |  |
| GET | `/company/settings` | Lesen ist jedem eingeloggten User erlaubt, da die Grundwerte (z.B. Stundensatz) für die Kalkulationsanzeige gebraucht werden können. |
| GET | `/machines` |  |
| GET | `/machines/:id` |  |
| GET | `/overview/todos` |  |
| GET | `/overview/search` |  |
| GET | `/push/public-key` |  |
| GET | `/push/status` |  |
| POST | `/push/subscribe` |  |
| DELETE | `/push/subscribe` |  |
| POST | `/push/test` | Probe-Nachricht an die eigenen Geräte |
| GET | `/services` |  |
| GET | `/services/:id` |  |
| GET | `/suppliers` |  |
| GET | `/suppliers/:id` |  |
| POST | `/time-entries/start` | Start/Stopp/eigene Liste brauchen keine zusätzliche Permission – jeder darf SEINE EIGENE Zeit erfassen (siehe Kommentar in TimeEntriesService). |
| POST | `/time-entries/stop` |  |
| GET | `/time-entries/mine` |  |
| GET | `/time-entries/overtime/mine` | Eigene Überstunden für einen Tag (Standard: heute) – Selbstbedienung, keine zusätzliche Permission nötig. |
| GET | `/units` |  |

## Alle Schnittstellen nach Bereich

### `/`

Datei: `src/checklists/checklists.controller.ts`

Listen am Projekt

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/projects/:projectId/checklists` | ja | `site.use` |  |  |
| POST | `/projects/:projectId/checklists` | ja | `site.use`, `checklist.manage` |  |  |
| DELETE | `/checklists/:id` | ja | `site.use`, `checklist.manage` |  |  |
| POST | `/checklists/:id/items` | ja | `site.use` |  |  |
| PUT | `/checklists/items/:itemId` | ja | `site.use` |  |  |
| DELETE | `/checklists/items/:itemId` | ja | `site.use`, `checklist.manage` |  |  |
| POST | `/checklists/:id/comments` | ja | `site.use` |  |  |
| POST | `/checklists/:id/propose-template` | ja | `site.use` |  |  |

### `/`

Datei: `src/delivery-notes/delivery-notes.controller.ts`

Lieferscheine sehen und zuordnen: wer Dokumente sieht (Büro)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/delivery-notes` | ja | `document.read` |  |  |
| POST | `/delivery-notes` | ja | `document.read` |  | vorhandenes Dokument als Lieferschein erkennen (auch erneut) |
| PUT | `/delivery-notes/:id` | ja | `document.read` |  |  |
| GET | `/projects/:projectId/delivery-notes` | ja | `document.read` |  |  |
| GET | `/projects/:projectId/supplier-mail` | ja | `document.read`, `customer.read` |  | Mail-Entwurf an einen Lieferanten mit Projektnummer und Lieferadresse |

### `/`

Datei: `src/plans/plans.controller.ts`

Lagepläne: ansehen mit plan.read (auch Mitarbeiter), zeichnen mit plan.write

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/projects/:projectId/plans` | ja | `plan.read` |  |  |
| POST | `/projects/:projectId/plans` | ja | `plan.write` |  |  |
| GET | `/plans/:id` | ja | `plan.read` |  |  |
| PUT | `/plans/:id` | ja | `plan.write` |  |  |
| DELETE | `/plans/:id` | ja | `plan.write` |  |  |
| POST | `/plans/:id/background` | ja | `plan.write` |  |  |
| DELETE | `/plans/:id/background` | ja | `plan.write` |  |  |
| GET | `/plans/:id/background` | ja | `plan.read` |  |  |
| GET | `/plans/:id/quote-draft` | ja | `plan.read`, `quote.create` |  | Mengen fürs Angebot mit passenden Leistungen |
| PUT | `/plan-mappings/:key` | ja | `quote.create` |  |  |

### `/absences`

Datei: `src/absences/absences.controller.ts`

Sehen: wer die Plantafel sieht (Art nur mit Recht für Mitarbeiterdaten); eintragen und löschen: wer Mitarbeiterdaten sehen darf (Chef, Büro).

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/absences` | ja | `customer.read` |  |  |
| POST | `/absences` | ja | `employee.data.read` |  |  |
| DELETE | `/absences/:id` | ja | `employee.data.read` |  |  |

### `/ai`

Datei: `src/ai-gateway/ai-gateway.controller.ts`

Nutzen braucht "ai.use"; Anbieter einrichten die Systemeinstellungen.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/ai/gateway/status` | ja | – |  |  |
| POST | `/ai/gateway/complete` | ja | `ai.use` |  |  |
| GET | `/ai/providers` | ja | `system.settings.write` |  |  |
| POST | `/ai/providers` | ja | `system.settings.write` |  |  |
| PATCH | `/ai/providers/:id` | ja | `system.settings.write` |  |  |
| DELETE | `/ai/providers/:id` | ja | `system.settings.write` |  |  |
| POST | `/ai/providers/:id/test` | ja | `system.settings.write`, `ai.use` |  |  |
| GET | `/ai/tasks` | ja | `system.settings.write` |  | welche Aufgabe welcher Anbieter übernimmt |
| PUT | `/ai/tasks/:task` | ja | `system.settings.write` |  |  |
| POST | `/ai/assist/quote-text` | ja | `ai.use`, `quote.create` |  | Vorschlag für das Anschreiben eines Angebots |
| POST | `/ai/assist/site-summary` | ja | `ai.use`, `site.use` |  | Zusammenfassung der Baustellen-Nachrichten eines Projekts |
| POST | `/ai/assist/photo-description` | ja | `ai.use`, `site.use` |  | Baustellenfoto beschreiben lassen |
| POST | `/ai/assist/plans/:planId/drawing` | ja | `ai.use`, `plan.write` |  | Lageplan: Vorschlag der Zeichnungs-KI (wird nicht gespeichert) |

### `/appointments`

Datei: `src/appointments/appointments.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/appointments/my-day` | ja | – |  | Keine zusätzliche Permission: jeder eingeloggte User darf seinen eigenen Tag sehen. |
| GET | `/appointments/assignees` | ja | `customer.write` |  |  |
| GET | `/appointments/board` | ja | `customer.read` |  | Plantafel: Termine aller Mitarbeiter in einem Zeitraum |
| GET | `/appointments/by-project/:projectId` | ja | `customer.read` |  |  |
| POST | `/appointments` | ja | `customer.write` |  |  |
| PATCH | `/appointments/:id` | ja | `customer.write` |  |  |
| PATCH | `/appointments/:id/status` | ja | `customer.write` |  |  |

### `/articles`

Datei: `src/articles/articles.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/articles` | ja | – |  | Lesen ist grundsätzlich jedem eingeloggten User erlaubt (Name/Einheit werden z.B. für die Kalkulation benötigt) – die Preisfelder selbst werden aber pro User anhand seiner Rechte aus- oder eingeblendet. |
| GET | `/articles/:id` | ja | – |  |  |
| POST | `/articles` | ja | `masterdata.write` |  |  |
| PATCH | `/articles/:id` | ja | `masterdata.write` |  |  |

### `/audit-log`

Datei: `src/audit-log/audit-log.controller.ts`

Das Protokoll enthält auch Einkaufspreise und Rechteänderungen – daher ein eigenes Recht, standardmäßig nur für Administratoren.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/audit-log` | ja | `audit.read` |  |  |

### `/auth`

Datei: `src/auth/auth.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/auth/login` | **nein** | – | loginIpLimit je 60 s | Login ist das klassische Brute-Force-Ziel: 5 Versuche/Minute je Konto und IP (Throttler "login-account", app.module.ts) plus 30/Minute je IP über alle Konten hinweg (hier). Details in auth/login-throttle.ts. Der Browser bekommt die Sitzung als httpOnly-Cookie; das Token in der Antwort ist für API-Clients (Tests, spätere Mobile-App). |
| GET | `/auth/me` | ja | – |  | Die angemeldete Person – das Frontend stellt damit nach dem Neuladen die Sitzung aus dem Cookie wieder her. |
| POST | `/auth/logout` | **nein** | – |  |  |
| POST | `/auth/change-password` | ja | – | 10 je 60 s | Eigenes Passwort ändern. Meldet alle anderen Sitzungen ab und gibt für dieses Gerät ein neues Token zurück. |
| GET | `/auth/oidc` | **nein** | – |  | Anmelden mit Google (oder einem anderen OIDC-Anbieter). Die Login-Seite fragt, ob es eingerichtet ist, und zeigt dann den Knopf. |
| GET | `/auth/oidc/start` | **nein** | – | loginIpLimit je 60 s | Der Browser springt hierher und wird zum Anbieter weitergeleitet. State, Nonce und PKCE-Schlüssel liegen signiert in einem kurzlebigen Cookie. |
| GET | `/auth/oidc/callback` | **nein** | – | loginIpLimit je 60 s | Rücksprung vom Anbieter: Code eintauschen, Konto anmelden, zurück ins Frontend |

### `/bank`

Datei: `src/bank/bank.controller.ts`

Gleiches Recht wie Rechnungen und Zahlungen

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/bank/import` | ja | `invoice.create` |  | Kontoauszug im Format CAMT.053 (XML) einlesen |
| GET | `/bank/transactions` | ja | `invoice.create` |  |  |
| POST | `/bank/transactions/:id/book` | ja | `invoice.create` |  |  |
| POST | `/bank/transactions/:id/ignore` | ja | `invoice.create` |  |  |
| POST | `/bank/transactions/:id/reopen` | ja | `invoice.create` |  |  |

### `/calculations`

Datei: `src/calculations/calculations.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/calculations` | ja | – |  | Keine zusätzliche @RequirePermissions hier: JEDER eingeloggte User darf eine Kalkulation anstoßen, aber WELCHE Felder er im Ergebnis sieht, hängt von seinen Preisrechten ab (maskCalculationResult). |

### `/calendar/events`

Datei: `src/calendar/calendar.controller.ts`

Kalender: jeder angemeldete Nutzer (persönliche Termine, Firmen-Termine lesen); Firmen-Termine eintragen prüft der Service

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/calendar/events` | ja | – |  |  |
| POST | `/calendar/events` | ja | – |  |  |
| PUT | `/calendar/events/:id` | ja | – |  |  |
| DELETE | `/calendar/events/:id` | ja | – |  |  |

### `/checklist-templates`

Datei: `src/checklists/checklists.controller.ts`

Vorlagen: ansehen und vorschlagen auf der Baustelle (site.use), anlegen, ändern und prüfen der Einsatzplaner (checklist.manage, prüft der Service)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/checklist-templates` | ja | `site.use` |  |  |
| POST | `/checklist-templates` | ja | `site.use`, `checklist.manage` |  |  |
| PUT | `/checklist-templates/:id` | ja | `site.use`, `checklist.manage` |  |  |
| POST | `/checklist-templates/:id/review` | ja | `site.use`, `checklist.manage` |  |  |

### `/company/settings`

Datei: `src/company/company.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/company/settings` | ja | – |  | Lesen ist jedem eingeloggten User erlaubt, da die Grundwerte (z.B. Stundensatz) für die Kalkulationsanzeige gebraucht werden können. |
| PATCH | `/company/settings` | ja | `system.settings.write` |  |  |

### `/contracts`

Datei: `src/contracts/contracts.controller.ts`

Pflege- und Wartungsverträge: ansehen wie Projekte (customer.read), anlegen und planen wie Termine (customer.write, mit Preisen nur mit price.sale.read), abrechnen mit invoice.create

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/contracts` | ja | `customer.read` |  |  |
| GET | `/contracts/:id` | ja | `customer.read` |  |  |
| POST | `/contracts` | ja | `customer.write`, `price.sale.read` |  |  |
| PUT | `/contracts/:id` | ja | `customer.write`, `price.sale.read` |  |  |
| DELETE | `/contracts/:id` | ja | `customer.write` |  |  |
| POST | `/contracts/schedule` | ja | `customer.write` |  | Fällige Einsätze als Termine planen (alle aktiven Verträge oder einer) |
| POST | `/contracts/invoice-due` | ja | `invoice.create` |  | Alle fälligen Zeiträume als Rechnungsentwürfe |
| POST | `/contracts/:id/invoice` | ja | `invoice.create` |  | Nächsten Zeitraum eines Vertrags abrechnen (auch vor der Fälligkeit) |

### `/customers`

Datei: `src/customers/customers.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/customers` | ja | `customer.read` |  |  |
| GET | `/customers/:id` | ja | `customer.read` |  |  |
| GET | `/customers/:id/history` | ja | `customer.read` |  | Angebote, Rechnungen und Umsatz je Jahr (Beträge je nach Rechten) |
| POST | `/customers` | ja | `customer.write` |  |  |
| PATCH | `/customers/:id` | ja | `customer.write` |  |  |

### `/data-guardian/price-list`

Datei: `src/data-guardian/data-guardian.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/data-guardian/price-list/upload` | ja | `data.import` |  | Punkt 17: "Datei auswählen -> Format erkennen -> Daten erkennen -> Zuordnung vorschlagen -> Vorschau". Dieser Endpunkt deckt genau das ab und gibt (wie /analyze) NUR eine Vorschau zurück – nichts wird übernommen. Die zurückgegebenen "rows" können unverändert an /apply geschickt werden, um die Änderungen tatsächlich zu übernehmen. |
| POST | `/data-guardian/price-list/analyze` | ja | `data.import` |  |  |
| POST | `/data-guardian/price-list/apply` | ja | `data.import` |  |  |

### `/datev`

Datei: `src/datev/datev.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/datev/bookings` | ja | `data.export` |  | GET /datev/bookings?from=2026-09-01&to=2026-09-30 |
| GET | `/datev/debtors` | ja | `data.export` |  | GET /datev/debtors[?invoiced=1]: Debitoren-Stammdaten (Name, Anschrift) |

### `/demo`

Datei: `src/demo/demo.controller.ts`

Nur in der Demo (DEMO_MODE=1, docker-compose.demo.yml): Adressen im LAN für den QR-Code und die Demo-Anmeldungen für die Anmeldeseite. Sonst 404 – im Betrieb gibt es diese Daten nicht.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/demo/info` | **nein** | – |  |  |

### `/documents`

Datei: `src/documents/documents.controller.ts`

"Dokumente sehen" ist laut Punkt 8 eine eigene, geschützte Berechtigung – gilt hier für Lesen UND Registrieren (kein separates "Dokumente hochladen"-Recht im Ursprungsdokument definiert).

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/documents` | ja | `document.read` |  |  |
| GET | `/documents/by-project/:projectId` | ja | `document.read` |  | ?q=: Suche in Dateiname und erkanntem Text |
| GET | `/documents/:id` | ja | `document.read` |  |  |
| GET | `/documents/:id/download` | ja | `document.read` |  |  |
| POST | `/documents` | ja | `document.read` |  |  |
| POST | `/documents/upload` | ja | `document.read` |  | Echter Datei-Upload: Datei + Metadaten in einem Request statt "Datei irgendwo ablegen, dann Pfad manuell in POST /documents eintragen". |
| DELETE | `/documents/:id` | ja | `document.read`, `document.read`, `document.delete` |  | Löschen braucht zusätzlich ein eigenes Recht |

### `/employees`

Datei: `src/employees/employees.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/employees` | ja | `employee.data.read` |  | Mitarbeiterliste/-daten sind laut Punkt 8 im Ursprungsdokument ausdrücklich geschützt (employee.data.read). |
| GET | `/employees/:id` | ja | `employee.data.read` |  |  |
| POST | `/employees` | ja | `masterdata.write` |  |  |

### `/equipment`

Datei: `src/equipment/equipment.controller.ts`

Geräte und Fahrzeuge: ansehen, Schäden melden und Inventur zählen darf jeder auf der Baustelle (site.use); anlegen, Schäden erledigen und Wartungen pflegen das Büro/die Werkstatt (masterdata.write).

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/equipment` | ja | `site.use` |  |  |
| GET | `/equipment/damages` | ja | `site.use` |  |  |
| PUT | `/equipment/damages/:id` | ja | `site.use`, `masterdata.write` |  |  |
| GET | `/equipment/maintenance/due` | ja | `site.use` |  |  |
| PUT | `/equipment/maintenance/:id` | ja | `site.use`, `masterdata.write` |  |  |
| POST | `/equipment/maintenance/:id/done` | ja | `site.use`, `masterdata.write` |  |  |
| GET | `/equipment/:id` | ja | `site.use` |  |  |
| POST | `/equipment` | ja | `site.use`, `masterdata.write` |  |  |
| PUT | `/equipment/:id` | ja | `site.use`, `masterdata.write` |  |  |
| POST | `/equipment/:id/damages` | ja | `site.use` |  |  |
| POST | `/equipment/:id/maintenance` | ja | `site.use`, `masterdata.write` |  |  |

### `/finance`

Datei: `src/finance/finance.controller.ts`

Nur Geschäftsführung und Buchhaltung (Recht finance.read)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/finance/forecast` | ja | `finance.read` |  | Liquiditätsvorschau der nächsten 13 Wochen |
| GET | `/finance/overview` | ja | `finance.read` |  |  |
| GET | `/finance/transactions` | ja | `finance.read` |  |  |
| PATCH | `/finance/transactions/:id` | ja | `finance.read` |  | Kategorie von Hand zuordnen (null = ohne); optional als Regel merken |
| POST | `/finance/transactions/categorize` | ja | `finance.read` |  | Abbuchungen ohne Kategorie erneut nach Regeln und Gelerntem zuordnen |
| GET | `/finance/categories` | ja | `finance.read` |  |  |
| POST | `/finance/categories` | ja | `finance.read` |  |  |
| PATCH | `/finance/categories/:id` | ja | `finance.read` |  |  |
| DELETE | `/finance/categories/:id` | ja | `finance.read` |  |  |
| POST | `/finance/categories/:id/rules` | ja | `finance.read` |  |  |
| DELETE | `/finance/rules/:id` | ja | `finance.read` |  |  |
| GET | `/finance/recurring` | ja | `finance.read` |  |  |
| GET | `/finance/recurring/suggestions` | ja | `finance.read` |  |  |
| POST | `/finance/recurring` | ja | `finance.read` |  |  |
| PATCH | `/finance/recurring/:id` | ja | `finance.read` |  |  |
| DELETE | `/finance/recurring/:id` | ja | `finance.read` |  |  |
| GET | `/finance/contracts` | ja | `finance.read` |  | Versicherungen und Verträge mit Laufzeit und Kündigungsfrist |
| POST | `/finance/contracts` | ja | `finance.read` |  |  |
| PUT | `/finance/contracts/:id` | ja | `finance.read` |  |  |
| DELETE | `/finance/contracts/:id` | ja | `finance.read` |  |  |
| GET | `/finance/year` | ja | `finance.read` |  | Jahresüberblick: ?year=2026 (ohne Angabe das laufende Jahr) |

### `/finance/payables`

Datei: `src/finance/payables/payables.controller.ts`

Eingangsrechnungen – wie der ganze Finanzbereich nur für Geschäftsführung und Buchhaltung (Recht finance.read)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/finance/payables` | ja | `finance.read` |  |  |
| POST | `/finance/payables/extract` | ja | `finance.read` |  | Beleg einlesen (PDF, Foto, E-Rechnung): Vorschläge fürs Formular |
| POST | `/finance/payables/documents/:documentId/ai-read` | ja | `finance.read`, `finance.read`, `ai.use` |  | Beleg von der KI lesen lassen (braucht einen Anbieter, der Bilder versteht) |
| DELETE | `/finance/payables/documents/:documentId` | ja | `finance.read` |  | eingelesenen Beleg verwerfen, wenn doch keine Rechnung daraus wird |
| POST | `/finance/payables` | ja | `finance.read` |  |  |
| PATCH | `/finance/payables/:id` | ja | `finance.read` |  |  |
| DELETE | `/finance/payables/:id` | ja | `finance.read` |  |  |
| GET | `/finance/payables/:id/delivery-notes` | ja | `finance.read` |  | Lieferscheine zur Rechnung: zugeordnete und Vorschläge |
| PUT | `/finance/payables/:id/delivery-notes` | ja | `finance.read` |  |  |
| POST | `/finance/payables/:id/pay` | ja | `finance.read` |  |  |
| POST | `/finance/payables/:id/reopen` | ja | `finance.read` |  |  |
| POST | `/finance/payables/:id/cancel` | ja | `finance.read` |  |  |
| GET | `/finance/payables/:id/file` | ja | `finance.read` |  |  |

### `/health`

Datei: `src/health/health.controller.ts`

Bewusst OHNE Guards: für Monitoring/Load-Balancer/CI-Healthchecks, die sich nicht einloggen können. Liefert absichtlich keine Geschäftsdaten, nur ein Lebenszeichen.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/health` | **nein** | – |  |  |

### `/inventory-counts`

Datei: `src/equipment/equipment.controller.ts`

Inventur: Durchgang starten/abschließen (Büro), Geräte zählen (Baustelle)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/inventory-counts` | ja | `site.use` |  |  |
| POST | `/inventory-counts` | ja | `site.use`, `masterdata.write` |  |  |
| GET | `/inventory-counts/:id` | ja | `site.use` |  |  |
| PUT | `/inventory-counts/:id/items/:equipmentId` | ja | `site.use` |  |  |
| POST | `/inventory-counts/:id/close` | ja | `site.use`, `masterdata.write` |  |  |

### `/invoices`

Datei: `src/invoices/invoices.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/invoices/by-project/:projectId` | ja | `invoice.create` |  |  |
| GET | `/invoices/:id/pdf` | ja | `invoice.create` |  |  |
| GET | `/invoices/:id/xrechnung` | ja | `invoice.create` |  |  |
| GET | `/invoices/:id` | ja | `invoice.create` |  |  |
| POST | `/invoices/from-order` | ja | `invoice.create` |  |  |
| DELETE | `/invoices/:id` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/issue` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/cancel` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/send` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/payments` | ja | `invoice.create` |  | Zahlungseingang erfassen bzw. (Korrektur) wieder löschen |
| POST | `/invoices/:id/charges/waive` | ja | `invoice.create` |  |  |
| DELETE | `/invoices/:id/payments/:paymentId` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/dunning` | ja | `invoice.create` |  | Mahnwesen: nächste Mahnstufe anlegen, als PDF abrufen, per E-Mail senden |
| GET | `/invoices/:id/dunning/:noticeId/pdf` | ja | `invoice.create` |  |  |
| POST | `/invoices/:id/dunning/:noticeId/send` | ja | `invoice.create` |  |  |

### `/machines`

Datei: `src/machines/machines.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/machines` | ja | – |  |  |
| GET | `/machines/:id` | ja | – |  |  |
| POST | `/machines` | ja | `masterdata.write` |  |  |
| PATCH | `/machines/:id` | ja | `masterdata.write` |  |  |

### `/master-data-import`

Datei: `src/master-data-import/master-data-import.controller.ts`

Stammdaten-Import (Kunden, Lieferanten, Artikel, Maschinen): einlesen -> Spalten zuordnen -> Vorschau mit Abgleich -> ausgewählte Zeilen übernehmen. Wie der Preislisten-Import mit data.import, dazu masterdata.write.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/master-data-import/upload` | ja | `data.import`, `masterdata.write` |  |  |
| POST | `/master-data-import/text` | ja | `data.import`, `masterdata.write` |  |  |
| POST | `/master-data-import/:sessionId/preview` | ja | `data.import`, `masterdata.write` |  |  |
| POST | `/master-data-import/:sessionId/apply` | ja | `data.import`, `masterdata.write` |  |  |
| DELETE | `/master-data-import/:sessionId` | ja | `data.import`, `masterdata.write` |  |  |

### `/material-usage`

Datei: `src/material-usage/material-usage.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/material-usage/by-project/:projectId` | ja | `customer.read` |  |  |
| POST | `/material-usage` | ja | `customer.write` |  | Gleiche Permission wie Termine/Baustellendokumentation (customer.write) – siehe Entscheidungstabelle in STATUS.md. |

### `/metrics`

Datei: `src/metrics/metrics.controller.ts`

Für Prometheus: ohne Login, aber nur mit METRICS_TOKEN als Bearer-Token. Ohne eingestelltes Token ist der Endpunkt aus (404) – Metriken verraten Auslastung und Routen und gehören nicht ins offene Internet.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/metrics` | **nein** | – | ohne Limit |  |
| GET | `/metrics/history` | **nein** | – | ohne Limit | Auswertung des Verlaufs mit Vorschlägen für die Alarmschwellen (?days=28, ?format=text für den lesbaren Bericht) |

### `/ocr`

Datei: `src/ocr/ocr.controller.ts`

Gleiche Permission wie das Dokumente-Modul (document.read) – OCR ist Teil desselben fachlichen Bereichs (Punkt 15).

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/ocr/extract` | ja | `document.read` |  | Sofort-Variante: wartet auf das Ergebnis, läuft aber ebenfalls über die Warteschlange. Für große Scans besser /ocr/jobs. |
| POST | `/ocr/jobs` | ja | `document.read` |  | Auftrag anlegen: Antwort sofort (202) mit der Auftrags-ID. |
| GET | `/ocr/jobs/:id` | ja | `document.read` |  | Status und – wenn fertig – Ergebnis eines Auftrags |

### `/open-items`

Datei: `src/invoices/invoices.controller.ts`

Offene Posten: alle ausgestellten Rechnungen mit Restbetrag

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/open-items` | ja | `invoice.create` |  | ?customerId=: nur die Posten eines Kunden (Kundenseite) |

### `/orders`

Datei: `src/orders/orders.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/orders/by-project/:projectId` | ja | `customer.read` |  |  |
| GET | `/orders/:id` | ja | `customer.read` |  |  |
| POST | `/orders` | ja | `order.create` |  |  |
| PATCH | `/orders/:id/status` | ja | `order.create` |  |  |

### `/overview`

Datei: `src/overview/overview.controller.ts`

Übersicht für „Mein Tag“ und die Schnellsuche. Jeder Eintrag prüft das passende Recht selbst – ohne Recht fehlt er einfach.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/overview/todos` | ja | – |  |  |
| GET | `/overview/search` | ja | – |  |  |

### `/permissions`

Datei: `src/permissions/permissions.controller.ts`

Permissions sind global (nicht pro Firma), daher reicht ein einfacher findMany ohne companyId-Filter.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/permissions` | ja | `system.settings.write` |  |  |

### `/post-calculation`

Datei: `src/post-calculation/post-calculation.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/post-calculation/:projectId` | ja | `customer.read` |  |  |

### `/projects`

Datei: `src/projects/projects.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/projects` | ja | `customer.read` |  |  |
| GET | `/projects/by-property/:propertyId` | ja | `customer.read` |  |  |
| GET | `/projects/:id` | ja | `customer.read` |  |  |
| POST | `/projects` | ja | `customer.write` |  |  |
| PATCH | `/projects/:id/status` | ja | `customer.write` |  |  |
| PATCH | `/projects/:id` | ja | `customer.write` |  |  |

### `/projects/:projectId/diary`

Datei: `src/site-diary/site-diary.controller.ts`

Bautagebuch: wer auf der Baustelle arbeitet (site.use) – Mitarbeiter, Büro, Chef

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/projects/:projectId/diary` | ja | `site.use` |  |  |
| PUT | `/projects/:projectId/diary/:day` | ja | `site.use` |  |  |

### `/properties`

Datei: `src/properties/properties.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/properties/by-customer/:customerId` | ja | `customer.read` |  |  |
| GET | `/properties/:id` | ja | `customer.read` |  |  |
| POST | `/properties` | ja | `customer.write` |  |  |
| PATCH | `/properties/:id` | ja | `customer.write` |  |  |

### `/push`

Datei: `src/push/push.controller.ts`

Jeder angemeldete Nutzer darf seine eigenen Geräte an- und abmelden.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/push/public-key` | ja | – |  |  |
| GET | `/push/status` | ja | – |  |  |
| POST | `/push/subscribe` | ja | – |  |  |
| DELETE | `/push/subscribe` | ja | – |  |  |
| POST | `/push/test` | ja | – |  | Probe-Nachricht an die eigenen Geräte |

### `/quotes`

Datei: `src/quotes/quotes.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/quotes/by-project/:projectId` | ja | `customer.read` |  |  |
| GET | `/quotes/:id/pdf` | ja | `customer.read`, `price.sale.read` |  | Das PDF enthält Verkaufspreise -> zusätzlich price.sale.read nötig. |
| GET | `/quotes/:id/gaeb` | ja | `customer.read`, `price.sale.read` |  | GAEB-Angebotsabgabe (X84) mit Einheits- und Gesamtpreisen |
| POST | `/quotes/gaeb-import/:projectId` | ja | `quote.create` |  | GAEB-Leistungsverzeichnis (X83, auch X81/X82/X86) → Angebotsentwurf |
| GET | `/quotes/:id` | ja | `customer.read` |  |  |
| POST | `/quotes` | ja | `quote.create` |  |  |
| POST | `/quotes/:id/copy` | ja | `quote.create` |  | Kopie als neuer Entwurf (aktuelle Katalogpreise, freie Positionen ± %) |
| PUT | `/quotes/:id` | ja | `quote.create` |  | Nur im Entwurf; Positionen werden ersetzt und neu berechnet |
| POST | `/quotes/:id/approve` | ja | `quote.approve` |  |  |
| POST | `/quotes/:id/send` | ja | `quote.create` |  |  |
| POST | `/quotes/:id/outcome` | ja | `quote.create` |  |  |

### `/roles`

Datei: `src/roles/roles.controller.ts`

Rollenverwaltung ist Teil der Administration -> system.settings.write.

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/roles` | ja | `system.settings.write` |  |  |
| POST | `/roles` | ja | `system.settings.write` |  |  |
| PATCH | `/roles/:id/permissions` | ja | `system.settings.write` |  |  |
| POST | `/roles/:id/assign` | ja | `system.settings.write` |  |  |
| DELETE | `/roles/:id/assign/:userId` | ja | `system.settings.write` |  |  |

### `/services`

Datei: `src/services-catalog/services-catalog.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/services` | ja | – |  |  |
| GET | `/services/:id` | ja | – |  |  |
| POST | `/services` | ja | `masterdata.write` |  |  |
| POST | `/services/:id/components` | ja | `masterdata.write` |  |  |
| PATCH | `/services/:id` | ja | `masterdata.write` |  |  |
| DELETE | `/services/:id/components/:componentId` | ja | `masterdata.write` |  |  |

### `/setup`

Datei: `src/setup/setup.controller.ts`

ohne Anmeldung: nur solange es keinen Nutzer gibt (siehe SetupService)

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/setup/status` | **nein** | – |  |  |
| POST | `/setup` | **nein** | – |  |  |

### `/site`

Datei: `src/site/site.controller.ts`

Baustelle (Handy/Tablet): eigener Tag, Nachrichten und Fotos je Projekt

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/site/today` | ja | `site.use` |  |  |
| POST | `/site/appointments/:id/done` | ja | `site.use` |  |  |
| GET | `/site/unread` | ja | `site.use` |  |  |
| GET | `/site/projects/:projectId/messages` | ja | `site.use` |  |  |
| POST | `/site/projects/:projectId/messages` | ja | `site.use` |  |  |
| POST | `/site/projects/:projectId/read` | ja | `site.use` |  |  |
| POST | `/site/projects/:projectId/photos` | ja | `site.use` |  |  |
| GET | `/site/photos/:documentId` | ja | `site.use` |  |  |

### `/suppliers`

Datei: `src/suppliers/suppliers.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/suppliers` | ja | – |  |  |
| GET | `/suppliers/:id` | ja | – |  |  |
| POST | `/suppliers` | ja | `masterdata.write` |  |  |
| PATCH | `/suppliers/:id` | ja | `masterdata.write` |  |  |

### `/time-entries`

Datei: `src/time-entries/time-entries.controller.ts`

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| POST | `/time-entries/start` | ja | – |  | Start/Stopp/eigene Liste brauchen keine zusätzliche Permission – jeder darf SEINE EIGENE Zeit erfassen (siehe Kommentar in TimeEntriesService). |
| POST | `/time-entries/stop` | ja | – |  |  |
| GET | `/time-entries/mine` | ja | – |  |  |
| GET | `/time-entries/overtime/mine` | ja | – |  | Eigene Überstunden für einen Tag (Standard: heute) – Selbstbedienung, keine zusätzliche Permission nötig. |
| GET | `/time-entries/by-employee/:employeeId` | ja | `employee.data.read` |  |  |
| GET | `/time-entries/overtime/:employeeId` | ja | `employee.data.read` |  | Überstunden eines beliebigen Mitarbeiters (Vorgesetzte/Büro). |
| POST | `/time-entries/approve` | ja | `employee.data.read` |  | Sammelfreigabe: nur abgeschlossene Einträge, der Rest wird übersprungen |
| POST | `/time-entries/:id/approve` | ja | `employee.data.read` |  |  |
| PATCH | `/time-entries/:id` | ja | `employee.data.read` |  | Korrektur durch Vorgesetzte (dieselbe Berechtigung wie die Freigabe). |

### `/units`

Datei: `src/units/units.controller.ts`

Lesen darf jeder Angemeldete (für Angebotsformular und Stammdaten), ändern nur mit Stammdaten-Recht

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/units` | ja | – |  |  |
| PUT | `/units/:code` | ja | `masterdata.write` |  |  |
| DELETE | `/units/:code` | ja | `masterdata.write` |  |  |

### `/users`

Datei: `src/users/users.controller.ts`

Benutzerverwaltung ist Administration -> system.settings.write (wie Rollen).

| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |
|---|---|---|---|---|---|
| GET | `/users` | ja | `system.settings.write` |  |  |
| POST | `/users` | ja | `system.settings.write` |  |  |
| PATCH | `/users/:id` | ja | `system.settings.write` |  |  |
| POST | `/users/:id/password` | ja | `system.settings.write` |  |  |
