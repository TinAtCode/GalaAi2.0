# Einzelplatz durchtesten – Checkliste

Für den vollständigen Test der Mini-Vollversion (`BUERO.md`) auf einem Büro-Rechner. Jeder Punkt hat
ein erwartetes Ergebnis. Was abweicht, bitte mit Punktnummer, Bildschirmfoto und – wenn möglich –
dem Protokoll melden:

```
docker compose -f docker-compose.buero.yml --env-file .env.buero logs --tail=200 backend
```

Tipp: Zum Ausprobieren erst mit Demo-Daten (Teil A), danach sauber neu anfangen und echt einrichten
(Teil B). Die Befehle stehen jeweils für Windows / macOS-Linux.

## Teil A – Kurztest mit Demo-Daten

| # | Schritt | Erwartet |
|---|---|---|
| A1 | Docker Desktop starten, dann `ops\buero\start.cmd -DemoDaten` / `ops/buero/start.sh --demo-daten` | Erster Start 5–10 Min., am Ende Adressen und Einrichtungscode; Browser öffnet sich |
| A2 | Windows fragt nach der Zertifizierungsstelle → Ja | Seite lädt ohne Zertifikatswarnung (Schloss) |
| A3 | Auf der Login-Seite „Chef“ antippen | Angemeldet, gAla-Logo links oben |
| A4 | Einmal durch alle Bereiche der Navigation klicken | Jede Seite lädt, keine Fehlermeldung |
| A5 | Neu anfangen: Fenster schließen, `docker compose -f docker-compose.buero.yml --env-file .env.buero down -v`, `.env.buero` und `backups\buero` löschen | Nächster Start fragt wieder nach der Ersteinrichtung |

## Teil B – Echte Einrichtung

### Start und Zugang

| # | Schritt | Erwartet |
|---|---|---|
| B1 | `start.cmd` (Windows einmal **als Administrator**, für die Firewall-Regel) / `start.sh` | `.env.buero` entsteht, Einrichtungscode wird angezeigt |
| B2 | `.env.buero` sofort sichern (USB-Stick, Passwort-Manager) | – |
| B3 | Ersteinrichtung mit falschem Code | Abgelehnt |
| B4 | Ersteinrichtung mit richtigem Code: Firma, Name, E-Mail, Passwort | Angemeldet als Chef |
| B5 | Seite neu laden, abmelden, wieder anmelden | Sitzung bleibt bis zum Abmelden; falsches Passwort → Fehlermeldung |
| B6 | Einstellungen → Firma: Adresse, Steuernummer/USt-IdNr., Bankverbindung | Gespeichert; erscheint später auf Angebot und Rechnung |
| B7 | Einstellungen → Team: je einen Zugang mit Rolle Buchhaltung, Einsatzplaner und Mitarbeiter anlegen | Alle können sich anmelden; Mitarbeiter sieht keine Finanzen und Preise, Einsatzplaner gibt Checklisten-Vorlagen frei |
| B8 | Einstellungen → Darstellung: hell/dunkel, gAla/GartenAI umschalten | Wirkt sofort, bleibt nach Neuladen |

### Handy und Tablet

| # | Schritt | Erwartet |
|---|---|---|
| C1 | Handy im selben WLAN: angezeigte Adresse `https://<IP>:8443` öffnen | Seite erscheint (mit Warnung, solange das Zertifikat fehlt) |
| C2 | `https://<IP>:8443/demo-ca.crt` installieren und vertrauen (Schritte in `DEMO.md`) | Keine Warnung mehr |
| C3 | Als Mitarbeiter anmelden, „Zum Startbildschirm hinzufügen“ | App-Symbol gAla, öffnet ohne Browserleiste |
| C4 | Baustelle: Termin öffnen, Zeit stempeln, Foto aufnehmen, Nachricht ans Büro | Im Büro sichtbar (Zeiten, Foto am Projekt, Nachricht mit Zähler) |
| C5 | Flugmodus an, Lageplan/Aufmaß bearbeiten, Flugmodus aus | Hinweis „Keine Verbindung“, danach wird übertragen |
| C6 | Sprachbefehl (Mikrofon-Knopf), z.B. „Plantafel“ | Seite wechselt; unbekannte Wörter → Hinweis |

### Kompletter Auftrag

| # | Schritt | Erwartet |
|---|---|---|
| D1 | Stammdaten: eigene Artikel/Leistungen anlegen oder Preisliste einlesen (Vorschau) | Übernommen wie in der Vorschau |
| D2 | Kunde → Objekt (Adresse) → Projekt | Projekt bekommt Nummer `P-<Jahr>-0001` |
| D3 | Kalkulation → Angebot, als PDF öffnen | Firmenangaben, Positionen, Summen und USt stimmen |
| D4 | Angebot annehmen → Auftrag, Termine in der Plantafel verteilen | Mitarbeiter sieht die Termine auf dem Handy |
| D5 | Plantafel: Entwurf „was wäre wenn“, Projekt verschieben, verwerfen | Nichts ändert sich ohne „Übernehmen“ |
| D6 | Lageplan zeichnen, Mengen ins Angebot übernehmen | Mengen passen zum Plan |
| D7 | Bautagebuch-Eintrag mit Behinderung, Checkliste abhaken | Am Projekt sichtbar |
| D8 | Lieferschein hochladen (Foto/PDF) | Lieferant und Projekt vorgeschlagen, bestätigen hängt ihn ans Projekt |
| D9 | Abschlagsrechnung, dann Schlussrechnung | Abschlag wird abgezogen; PDF und XRechnung herunterladbar |
| D10 | Rechnung per E-Mail (nur mit `SMTP_URL` in `.env.buero`) | Mail kommt mit PDF und XML an |
| D11 | Kontoauszug (CSV/MT940/CAMT) einlesen, Zahlung zuordnen | Rechnung bezahlt, offene Posten stimmen |
| D12 | Überfällige Rechnung mahnen | Mahnung als PDF; Gebühren nur wenn eingeschaltet |
| D13 | Finanzen: Jahresüberblick, Verträge/Versicherungen anlegen | Diagramme und Summen plausibel |
| D14 | Geräte: Schaden melden, Wartung planen | Termin im Kalender |
| D15 | DATEV-Export für einen Monat und „Debitoren (Kunden) herunterladen“ | Beide Dateien lassen sich in DATEV bzw. beim Steuerbüro einlesen; die Konten tragen die Kundennamen |
| D16 | Optional: GAEB-Leistungsverzeichnis (.X83) eines Auftraggebers am Projekt einlesen, Preise eintragen, „GAEB X84“ | Angebot mit den Ordnungszahlen des LV; die X84 lässt sich beim Auftraggeber bzw. in dessen AVA einlesen |

### Sicherung, Update, Neustart

| # | Schritt | Erwartet |
|---|---|---|
| E1 | Nach dem ersten Start in `backups\buero` schauen | Ein Ordner mit Datum, darin `gartenai.dump`, `uploads.tgz`, `SHA256SUMS` |
| E2 | `backup-now.cmd` / `backup-now.sh` | Weiterer Ordner |
| E3 | Einen Testkunden anlegen, dann `restore.cmd` (Auswahl) / `restore.sh backups/buero/<Stand>` | Nach dem Zurückspielen ist der Testkunde weg, alles andere da (auch Fotos/Dokumente) |
| E4 | Rechner neu starten, Docker Desktop startet mit | GartenAI ist ohne weiteres Zutun erreichbar |
| E5 | `stop.cmd` / `stop.sh`, dann `start.cmd` / `start.sh` | Daten unverändert |
| E6 | `update.cmd` / `update.sh` | Sichert zuerst, startet danach mit neuer Version |

### Optional: Cloud, unterwegs, Google

| # | Schritt | Erwartet |
|---|---|---|
| F1 | `cloud-setup.cmd` / `cloud-setup.sh` (z.B. Google Drive oder Nextcloud), danach `start` | „Verbindung klappt“; nach spätestens einer Stunde Ordner `gartenai` im Speicher, Dateinamen unlesbar |
| F2 | Passwörter `CLOUD_CRYPT_PASSWORD*` aus `.env.buero` getrennt aufbewahren | – |
| F3 | Tailscale auf Rechner und Handy, `start` neu | Handy im Mobilnetz erreicht `https://<Tailscale-IP>:8443` |
| F4 | Google-Anmeldung einrichten (`BUERO.md`, braucht Domain oder `….ts.net`-Namen) | Knopf „Anmelden mit Google“; nur angelegte E-Mail-Adressen kommen hinein |

## Rückmeldung

Am einfachsten eine Liste der Punktnummern mit „ok“ oder einer kurzen Beschreibung, was anders war.
Bei Fehlern hilft das Backend-Protokoll (Befehl oben) und die Uhrzeit.
