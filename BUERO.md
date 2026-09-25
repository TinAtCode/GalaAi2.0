# GartenAI im Büro – ein Rechner, echte Daten

Die Mini-Vollversion: GartenAI läuft auf einem Rechner im Büro (Windows, macOS oder Linux). Handys
und Tablets im selben Netz nutzen die App über die Adresse dieses Rechners, einen Server braucht es
nicht. Anders als die Demo (`DEMO.md`) ist sie für echte Daten gedacht:

- Die Geheimnisse sind je Installation eigene.
- Die Firma und den ersten Zugang legt man selbst an.
- HTTPS ist immer an.
- Jeden Tag entsteht automatisch eine Sicherung.

Für mehrere Standorte oder Zugriff von überall ist ein Server besser (`BETRIEB.md`).

## Einmalig vorbereiten

1. **Docker Desktop** installieren und starten (unter Linux Docker Engine mit Compose).
2. Dieses Repository herunterladen (ZIP von GitHub oder `git clone`) und in einen festen Ordner legen,
   z.B. `Dokumente\GartenAI`.
3. Der erste Start baut die Images und braucht dafür **Internet** (etwa 5–10 Minuten).

## Starten

| System | Befehl |
|---|---|
| Windows | Doppelklick auf `ops\buero\start.cmd` |
| macOS/Linux | `ops/buero/start.sh` |

**Beim ersten Start:**

1. Das Skript legt `.env.buero` mit den Geheimnissen dieser Installation an: Datenbank-Passwort,
   Schlüssel und Einrichtungscode.
   **Diese Datei gut aufbewahren**, zusammen mit den Sicherungen.
2. Es erzeugt eine eigene Zertifizierungsstelle für HTTPS. Unter Windows fragt das System einmal, ob
   es ihr vertrauen soll: mit Ja bestätigen.
3. Es zeigt die Adressen und den **Einrichtungscode** an.
4. Im Browser öffnet sich GartenAI mit der **Ersteinrichtung**: Einrichtungscode, Firma, Name, E-Mail
   und Passwort eingeben. Danach ist man als Chef angemeldet. Ohne den Code kann niemand im Netz die
   Einrichtung übernehmen, und sie klappt nur ein einziges Mal.
5. Weitere Zugänge (Büro, Mitarbeiter) legt man danach unter Einstellungen → Team an.

**Zum Ausprobieren:** `ops/buero/start.sh --demo-daten` (Windows: `start.cmd -DemoDaten`) lädt in eine
leere Installation den Musterbetrieb aus der Demo, mit Demo-Agent und den Demo-Zugängen (Passwort
`demo12345`). Für den echten Einsatz danach neu anfangen: Ordner `backups/buero` sichern oder löschen,
`docker compose -f docker-compose.buero.yml --env-file .env.buero down -v` und `.env.buero` löschen.

## Handys verbinden

- Handy und Rechner im selben Netz. Die Adresse zeigt das Startskript, z.B. `https://192.168.1.20:8443`.
- Einmal das Stammzertifikat aufs Handy: `https://<adresse>:8443/demo-ca.crt` öffnen, installieren
  und vertrauen. Die Schritte für iPhone und Android stehen in `DEMO.md` unter „Mit HTTPS“. Danach
  lässt sich die App installieren und läuft auch ohne Netz.
- **Windows-Firewall:** Einmal `start.cmd` als Administrator starten, dann legt das Skript die Regel
  für Port 8443 an. Sonst die Regel von Hand anlegen (siehe `DEMO.md`).

## Sicherung

- **Automatisch:** Der Dienst `backup` sichert einmal am Tag Datenbank und Dokumente nach
  `backups/buero/<Datum-Uhrzeit>`. War der Rechner nachts aus, sichert er beim nächsten Start. Die
  letzten 14 Sicherungen bleiben (`BACKUP_KEEP` in `.env.buero`).
- **Sofort:** `ops/buero/backup-now.sh` (Windows: `backup-now.cmd`).
- **Außer Haus:** Den Ordner `backups/buero` und `.env.buero` regelmäßig auf einen USB-Stick oder in
  die Cloud kopieren. Die automatische Übertragung in die Cloud kommt als Nächstes.
- **Zurückspielen:** `ops/buero/restore.sh backups/buero/20261004-021500`. Es ersetzt Datenbank und
  Dokumente und prüft vorher die Prüfsummen. Unter Windows im Ordner in einer Git-Bash oder WSL
  ausführen.

## Mails

Rechnungen und Mahnungen per E-Mail brauchen einen Mail-Zugang, z.B. das Postfach der Firma. In
`.env.buero` eintragen und neu starten:

```
SMTP_URL=smtps://benutzer:passwort@mail.example.de:465
MAIL_FROM=Musterbetrieb GaLaBau <info@musterbetrieb.de>
```

Ohne Eintrag werden Mails nicht verschickt.

## Anmelden mit Google

Statt mit Passwort können sich Mitarbeiter mit ihrem Google-Konto anmelden. GartenAI legt dabei keine
Konten an: Angemeldet wird nur, wer im Büro schon als Nutzer angelegt ist, und zwar mit derselben
E-Mail-Adresse wie bei Google. Das Passwort funktioniert daneben weiter.

1. Die Mini-Vollversion braucht dafür eine Adresse, die Google akzeptiert: eine eigene Domain
   (z.B. über den Cloudflare-Tunnel) oder einen Tailscale-Namen (`….ts.net`). Reine IP-Adressen
   lehnt Google ab.
2. In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) unter
   „Anmeldedaten“ eine **OAuth-Client-ID** vom Typ „Webanwendung“ anlegen. Beim ersten Mal fragt
   Google nach dem „Zustimmungsbildschirm“: Name der Firma eintragen, Typ „Intern“ bei Google
   Workspace, sonst „Extern“. Als **autorisierte Weiterleitungs-URI** eintragen:
   `https://<Ihre Adresse>/api/auth/oidc/callback`
3. Client-ID und Clientschlüssel in `.env.buero` eintragen und neu starten:

```
OIDC_CLIENT_ID=1234-abc.apps.googleusercontent.com
OIDC_CLIENT_SECRET=GOCSPX-…
OIDC_REDIRECT_URI=https://<Ihre Adresse>/api/auth/oidc/callback
# optional: nur Adressen der eigenen Firma
OIDC_ALLOWED_DOMAINS=musterbetrieb.de
```

Auf der Login-Seite erscheint dann „Anmelden mit Google“. Andere Anbieter mit OpenID Connect
(Microsoft 365, Nextcloud, Keycloak) gehen genauso: zusätzlich `OIDC_ISSUER` setzen (z.B.
`https://login.microsoftonline.com/<Tenant-ID>/v2.0`) und mit `OIDC_LABEL` den Knopf benennen.

## Update

`ops/buero/update.sh` sichert zuerst, holt dann die neue Version (bei `git clone`) und baut neu. Die
Datenbank wird beim Start automatisch angepasst.

Unter Windows oder bei ZIP-Download:
1. `backup-now.cmd` ausführen.
2. Die neue Version über den Ordner entpacken. `.env.buero` und `backups` bleiben dabei erhalten.
3. `start.cmd` ausführen.

## Beenden

`ops/buero/stop.sh` bzw. `stop.cmd`. Die Daten bleiben erhalten. Docker Desktop startet GartenAI beim
nächsten Hochfahren wieder mit, wenn Docker Desktop selbst automatisch startet.
