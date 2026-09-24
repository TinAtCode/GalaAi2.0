# Demo für Vorführungen – ein Laptop, Handys im WLAN

GartenAI läuft komplett auf einem Rechner (Windows, macOS oder Linux), ohne Server und ohne
Internet während der Vorführung. Handys und Tablets im selben WLAN öffnen die App über die Adresse
des Laptops – als Mitarbeiter auf der Baustelle, während der Laptop das Büro zeigt.

**Nur für Vorführungen:** feste Demo-Passwörter, Mails werden nicht verschickt. Für echte Daten gilt
`BETRIEB.md`.

## Einmalig vorbereiten

1. **Docker Desktop** installieren und starten (Windows/macOS; unter Linux Docker Engine mit Compose).
2. Dieses Repository herunterladen (ZIP von GitHub oder `git clone`).
3. Der erste Start baut die Images und braucht dafür **Internet** (etwa 5–10 Minuten). Danach geht
   alles ohne Internet – am besten vor dem Termin einmal starten.

## Starten

| System | Befehl |
|---|---|
| Windows | Doppelklick auf `ops\demo\start.cmd` |
| macOS/Linux | `ops/demo/start.sh` |

Das Skript zeigt am Ende die Adressen, z.B. `http://192.168.1.20:8080`, und öffnet (Windows) den
Browser. Die **Anmeldeseite** zeigt im Demo-Modus die drei Zugänge zum Antippen und einen
**QR-Code** für das Handy.

| Zugang | E-Mail | sieht |
|---|---|---|
| Chef | `admin@musterbetrieb.de` | alles |
| Büro | `buero@musterbetrieb.de` | alles außer Systemeinstellungen und Protokoll |
| Mitarbeiter | `mitarbeiter@musterbetrieb.de` | Mein Tag, Baustelle, Zeiten – keine Preise |

Passwort jeweils `demo12345`.

## Was drin ist

- **Kunden und Projekte:** vier Kunden, darunter eine Hausverwaltung mit Pflegevertrag.
- **Angebote:** eines ist verschickt und wartet auf Antwort, zwei wurden angenommen und sind zu
  Aufträgen geworden.
- **Rechnungen:** ein bezahlter Abschlag und eine Schlussrechnung, die seit 45 Tagen offen ist (offene
  Posten, Mahnung).
- **Termine dieser Woche:** in der Plantafel, für den Mitarbeiter heute zwei Einsätze auf der Baustelle.
- **Pflegevertrag:** wöchentliche Einsätze sind schon geplant, die erste Monatsrechnung liegt als
  Entwurf vor.
- **Baustelle:** Nachrichten zwischen Mitarbeiter und Büro.
- **KI ohne Internet:** Als KI-Anbieter ist der **Demo-Agent** eingerichtet. Er beantwortet alle
  KI-Aufgaben nach festen Regeln, ohne echte KI, und jede Antwort sagt das auch. Damit lassen sich die
  Abläufe zeigen:
  - Angebot → „Vorschlag der KI“
  - Baustelle → „Verlauf zusammenfassen“ und „Foto beschreiben“
  - Eingangsrechnung → „Mit KI lesen“ (mit erkennbaren Beispielwerten)
  - Lageplan → „KI zeichnen“, z.B. „Terrasse 5 × 4 m, daneben Rasen 10 × 6 m mit Mähkante, drei
    Bäume“

  Für echte Antworten unter Einstellungen → KI-Anbieter einen echten Anbieter eintragen (siehe
  `KI-ANBINDUNG.md`).

Vorschlag für den Ablauf:

1. Am Laptop als Chef: offene Posten und Plantafel zeigen.
2. Auf dem Handy als Mitarbeiter: Baustelle öffnen, „Hier anfangen“, ein Foto und eine Nachricht
   schicken.
3. Am Laptop im Projekt zeigen, dass Foto und Nachricht angekommen sind.
4. Im Projekt einen Lageplan anlegen, „KI zeichnen“ und die Mengen ins Angebot übernehmen.

## Handy verbinden

- **Handy und Laptop im selben WLAN.** Gäste-WLANs trennen die Geräte oft voneinander – dann ein
  eigenes Netz nutzen, z.B. den Hotspot des Handys oder einen mitgebrachten Router.
- **QR-Code scannen** oder die angezeigte Adresse im Browser eingeben.
- **Windows-Firewall:** Beim ersten Start fragt Windows eventuell nach der Freigabe für Docker –
  „Private Netzwerke“ erlauben. Startet man `start.cmd` als Administrator, legt das Skript die Regel
  selbst an. Von Hand: Windows-Sicherheit → Firewall → Erweiterte Einstellungen → Eingehende Regeln →
  Neue Regel → Port → TCP 8080 (bzw. 8443) → Zulassen → nur „Privat“.
- **macOS** fragt beim ersten Zugriff, ob Docker eingehende Verbindungen annehmen darf – erlauben.

## Ohne und mit HTTPS

Ohne HTTPS (Standard) funktioniert alles im Browser des Handys. Zwei Dinge gehen ohne HTTPS nicht:

- die App **auf dem Handy installieren** (Startbildschirm)
- die App auf dem Handy **ohne Netz** öffnen

Auch ohne HTTPS bleibt auf der Baustelle alles erhalten, was einmal geöffnet war. Fotos und
Nachrichten warten im Funkloch auf dem Gerät und gehen später raus.

**Mit HTTPS:** `ops/demo/start.sh --https` bzw. `ops\demo\start.cmd -Https`.

1. Das Skript erzeugt eine eigene **Demo-Zertifizierungsstelle** (in `ops/demo/certs`, nicht im
   Repository).
2. Die App läuft dann unter `https://<adresse>:8443`.
3. Damit das Handy der Verbindung vertraut, dort einmal das Stammzertifikat installieren: auf dem
   Handy `https://<adresse>:8443/demo-ca.crt` öffnen. Die Warnung beim ersten Aufruf bestätigen.
   - **iPhone/iPad:** Profil laden → Einstellungen → „Profil geladen“ → Installieren. Danach unter
     Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen „GartenAI Demo CA“
     einschalten.
   - **Android:** Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten → Zertifikat
     installieren → CA-Zertifikat (je nach Hersteller etwas anders benannt).
4. Danach im Browser: „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.

Die Zertifizierungsstelle bleibt beim nächsten Start erhalten, auch wenn sich die Adresse im WLAN
ändert. Das Zertifikat muss also nur einmal aufs Handy. Nach der Vorführung kann man es dort wieder
löschen.

## Beenden und zurücksetzen

| | Windows | macOS/Linux |
|---|---|---|
| Beenden (Daten bleiben) | `ops\demo\stop.cmd` | `ops/demo/stop.sh` |
| Zurücksetzen (frische Beispieldaten) | `ops\demo\reset.cmd` | `ops/demo/reset.sh` |

Die Termine liegen immer in der Woche des ersten Starts. Vor einer Vorführung an einem anderen Tag
zurücksetzen.

## Wenn etwas nicht geht

- **„Docker läuft nicht“:** Docker Desktop starten, warten bis das Wal-Symbol ruhig ist.
- **Port belegt:** anderen Port wählen, z.B. `DEMO_PORT=9090 ops/demo/start.sh` bzw. unter Windows
  vorher `set DEMO_PORT=9090`.
- **Handy erreicht die Demo nicht:** gleiche WLAN-Adresse im Bereich (z.B. beide `192.168.1.x`)?
  Firewall (siehe oben)? Gäste-WLAN?
- **Beispieldaten fehlgeschlagen:** zurücksetzen. Die Logs zeigt
  `docker compose -f docker-compose.demo.yml logs backend demo-data`.
