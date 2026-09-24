# KI anbinden – eigene APIs, eigene Agenten, selbst gehostet

GartenAI ist bewusst an keinen KI-Anbieter gebunden. Jede Firma richtet ihre Anbieter selbst ein
(Einstellungen → KI-Anbieter, Recht „Systemeinstellungen“), beliebig viele, einer davon ist der
Standard. Ohne Einrichtung antwortet ein Platzhalter; nichts verlässt den Server.

| Art | Wofür | Adresse |
|---|---|---|
| OpenAI-kompatibel | Ollama, LM Studio, vLLM, LocalAI, llama.cpp-Server, OpenRouter, OpenAI, Mistral … | bis einschließlich `/v1`, z.B. `http://192.168.1.20:11434/v1` |
| Anthropic | Claude über die Anthropic-API | leer = `https://api.anthropic.com` |
| Eigener Agent | eigener Dienst mit eigener Logik, eigenen Werkzeugen, eigenem Modell | volle Adresse, z.B. `http://agent.lan:8080/gartenai` |

Der **Testen**-Knopf schickt eine kurze Frage und zeigt Antwort und Dauer (oder den Fehler).

**Demo-Agent:** Das Demo-Paket (`DEMO.md`) bringt einen Agenten mit, der alle Aufgaben nach festen
Regeln beantwortet, ohne echte KI (`backend/src/demo-agent`). Er ist zugleich ein Beispiel für den
Agentenvertrag, auch für `data.objects` beim Zeichnen.

## Aufgaben: welcher Anbieter wofür

Jeder Anbieter hat Angaben dazu, was er **kann**:

- **Text:** Standard.
- **Bilder verstehen:** z.B. Belege oder Baustellenfotos lesen.
- **Bilder/Zeichnungen erzeugen:** z.B. über einen eigenen Agenten.

Unter **Aufgaben** lässt sich jede Funktion der App einem Anbieter zuordnen, auf Wunsch mit eigenem
Modell. So können verschiedene Modelle desselben Anbieters an verschiedenen Stellen arbeiten, z.B. ein
kleines, schnelles Modell für Zusammenfassungen und ein großes für Angebotstexte. Genauso können
verschiedene Anbieter an verschiedenen Stellen arbeiten.

| Aufgabe | Schlüssel (`task`) | braucht | wo in der App |
|---|---|---|---|
| Freie Frage | `frage` | Text | Einstellungen → KI-Anbieter |
| Angebotstext entwerfen | `angebotstext` | Text | Angebot anlegen/bearbeiten → „Vorschlag der KI“ |
| Baustellen-Verlauf zusammenfassen | `baustelle_zusammenfassung` | Text | Projekt bzw. Baustelle → „Verlauf zusammenfassen“ |
| Beleg lesen | `beleg_lesen` | Bilder verstehen | Finanzen → Eingangsrechnungen → Beleg einlesen → „Mit KI lesen“ |
| Baustellenfoto beschreiben | `foto_beschreiben` | Bilder verstehen | Foto in den Baustellen-Nachrichten → „Foto beschreiben“ |
| Lageplan zeichnen | `lageplan_zeichnen` | Bilder/Zeichnungen erzeugen | Lageplan → „KI zeichnen“ |

Für jede Aufgabe gilt der Reihe nach:

1. Ist ein Anbieter zugeordnet und eingeschaltet und kann er, was die Aufgabe braucht, übernimmt er.
   Das Modell der Zuordnung ersetzt dabei das Modell des Anbieters.
2. Sonst übernimmt der Standard-Anbieter, wenn er es kann.
3. Sonst ist die Funktion nicht verfügbar: Der Knopf erscheint nicht, und der Aufruf meldet einen
   Hinweis auf die Einstellungen.

Den Kontext stellt der Server zusammen, nur mit dem, was die Aufgabe braucht:

- **Angebotstext:** Kunde, Objekt, Projekt, Leistungen und Mengen, ohne Preise.
- **Zusammenfassung:** die letzten 100 Nachrichten der Baustelle.

Das Anschreiben steht im Angebots-PDF über den Positionen und bleibt bis zur Freigabe änderbar.

**Bilder:**
- **Wie sie ankommen:** Fotos gehen unverändert an die KI (JPG, PNG, WebP, GIF, höchstens 5 MB). Von
  PDFs gehen die ersten zwei Seiten als Bild mit.
- **Format je Anbieter:** OpenAI-kompatibel als `image_url` (data-URL), Anthropic als `image`-Block
  (base64). Ein eigener Agent bekommt sie als `attachments` (siehe Vertrag).
- **Beleg lesen:**
  - Die KI soll nur JSON mit festen Feldern liefern: Lieferant, Nummer, Datum, Fälligkeit, Beträge,
    IBAN, Skonto. Ein eigener Agent darf die Felder direkt in `data` liefern.
  - GartenAI prüft jeden Wert (Datum, Betrag, IBAN-Prüfsumme, nicht die eigene IBAN). Was nicht passt,
    bleibt leer.
  - Das Ergebnis ist nur ein Vorschlag im Formular.
- **Protokoll:** Das Audit-Log zählt die Bilder, speichert sie aber nicht.

**Lageplan zeichnen (Zeichnungs-KI):**
- **Auftrag:** Man beschreibt in Worten, was gezeichnet werden soll, z.B. „Terrasse 5 × 4 m links oben,
  daneben Rasen mit Mähkante“.
- **Was die KI bekommt:** den aktuellen Plan in Metern (Größe, vorhandene Objekte) und die erlaubten
  Objektarten und Piktogramme.
- **Was sie liefert:** JSON `{ "objects": [{ "type", "points": [[x, y], …] in Metern, "label"?,
  "props"? }] }`. Ein eigener Agent darf das direkt in `data.objects` liefern.
- **Was GartenAI daraus macht:**
  - Die Punkte werden in Planeinheiten umgerechnet und jedes Objekt wie beim Speichern geprüft.
  - Ungültige Objekte fallen weg und werden gezählt.
  - Höchstens 200 Objekte je Vorschlag.
- **Als Vektor:** Weil die KI Objekte statt Pixel zeichnet, stimmen Flächen und Längen, und die
  Mengen gehen wie gewohnt ins Angebot.
- **Speichern:** Der Vorschlag kommt in den Editor und lässt sich rückgängig machen. Gespeichert wird
  erst mit „Speichern“.
- **Bild als Hintergrund:** Ein eigener Agent darf zusätzlich `data.image` liefern (`{ mediaType:
  "image/png" | "image/jpeg", data: Base64 }`, höchstens 10 MB). Es lässt sich dann als Hintergrund
  übernehmen, z.B. für eine Skizze aus einem Bildmodell.

Selbst gehostete Modelle, die Bilder verstehen, sind z.B. `llava`, `llama3.2-vision` oder `qwen2.5vl`
in Ollama.

**Skills oder Aufgaben?** Skills sind eine Eigenheit einzelner Anbieter. GartenAI spricht neutral von
Aufgaben: Ein eigener Agent bekommt den Schlüssel der Aufgabe in `task`. Wie er sie erledigt, ob mit
Skills, Werkzeugen oder mehreren Modellen, entscheidet der Agent selbst.

## Selbst gehostet

**Ollama** auf einem Rechner im Büro:

```bash
ollama pull llama3.1
OLLAMA_HOST=0.0.0.0 ollama serve        # im LAN erreichbar
```

In GartenAI: Vorlage „Ollama“, Adresse `http://<rechner>:11434/v1`, Modell `llama3.1`, kein Schlüssel.

**Läuft das Modell auf demselben Server wie GartenAI (Docker):** `localhost` ist im Container der
Container selbst. Stattdessen `http://host.docker.internal:11434/v1` eintragen
(`docker-compose.prod.yml` richtet den Namen ein). Ollama muss dann auf `0.0.0.0` hören.

**LM Studio:** Server starten (Developer → Start Server), Adresse `http://<rechner>:1234/v1`, Modell
wie in LM Studio angezeigt. **vLLM:** `vllm serve <modell>` → `http://<rechner>:8000/v1`.

Selbst gehostete Modelle sind langsamer: Zeitlimit großzügig einstellen (Standard 60 s, bis 600 s).

## Eigener Agent – der Vertrag (Version 1)

GartenAI schickt `POST` an die eingetragene Adresse:

```json
{
  "version": 1,
  "task": "frage",
  "prompt": "Was steht diese Woche an?",
  "context": { "…": "bereits nach den Rechten des Fragenden gefiltert" },
  "caller": { "companyId": "…", "userId": "…", "permissions": ["ai.use", "…"] },
  "model": "optional, aus der Einrichtung",
  "maxTokens": 1024,
  "systemPrompt": "optional, aus der Einrichtung",
  "attachments": [{ "mediaType": "image/png", "data": "<Base64>" }]
}
```

Kopfzeilen:

- `X-GartenAI-Timestamp`: Unix-Zeit in Sekunden
- mit Schlüssel zusätzlich `Authorization: Bearer <Schlüssel>` und
  `X-GartenAI-Signature: sha256=<HMAC-SHA256(Schlüssel, "<Timestamp>.<Inhalt>") als Hex>`

Der Agent sollte die Signatur prüfen und Anfragen verwerfen, deren Zeitstempel älter als ein paar
Minuten ist. `task` sagt, wofür gefragt wird: `verbindungstest` beim Testen-Knopf, `frage` für freie
Fragen und die Aufgaben aus der Tabelle oben. Weitere Aufgaben kommen mit den Funktionen der App
dazu. Unbekannte Aufgaben sollte der Agent mit einem Fehler beantworten.

Antwort (HTTP 200, JSON):

```json
{ "text": "Antwort für den Nutzer", "data": { "beliebige": "strukturierte Daten" }, "model": "optional" }
```

Fehler: ein HTTP-Status ≥ 400 mit `{ "error": "…" }` – die Meldung erscheint beim Nutzer.

Minimaler Agent in Node.js:

```js
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
const KEY = process.env.AGENT_KEY;

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ts = req.headers['x-gartenai-timestamp'];
    const expected = `sha256=${createHmac('sha256', KEY).update(`${ts}.${body}`).digest('hex')}`;
    const given = String(req.headers['x-gartenai-signature'] ?? '');
    const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
    if (!fresh || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      res.writeHead(401).end(JSON.stringify({ error: 'Signatur ungültig' }));
      return;
    }
    const { task, prompt } = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: task === 'verbindungstest' ? 'OK' : `Du fragst: ${prompt}` }));
  });
}).listen(8080);
```

## Sicherheit

- **Schlüssel** liegen verschlüsselt in der Datenbank (AES-256-GCM, Schlüssel aus `SECRET_KEY`, sonst
  aus `JWT_SECRET` abgeleitet) und werden nie wieder ausgegeben – auch nicht im Audit-Log. Für den
  Betrieb `SECRET_KEY` setzen und nicht mehr ändern.
- **Was die KI sieht:** nur, was der fragende Nutzer selbst sehen darf. Zusätzlich entfernt das Gateway
  Felder, die nach Einkaufspreis, Marge oder Lohn aussehen, wenn das Recht fehlt.
- **Protokoll:** jeder Aufruf steht im Audit-Log (Quelle „ai“): Aufgabe, Anbieter, Modell, Frage (die
  ersten 2000 Zeichen), Dauer, Fehler. Die Antwort selbst wird nicht gespeichert.
- **Adressen:** Metadaten-Dienste der Cloud (169.254.x.x, fe80::) sind gesperrt, Weiterleitungen werden
  nicht verfolgt. Adressen im eigenen Netz sind erlaubt (dafür ist Selbst-Hosting da); mit
  `AI_BLOCK_PRIVATE_NETWORKS=1` sind auch sie gesperrt, z.B. wenn mehrere Firmen einen Server teilen.
  Die Prüfung löst den Namen vor dem Aufruf auf; wer den DNS-Eintrag kontrolliert, könnte ihn danach
  noch umbiegen – Anbieter einrichten darf darum nur, wer die Systemeinstellungen ändern darf.
- **Datenschutz:** Bei Anbietern im Internet verlassen die Daten der Frage das Haus –
  Auftragsverarbeitung (AVV) mit dem Anbieter klären. Selbst gehostete Modelle vermeiden das.

## Schnittstelle der App

- `GET /ai/gateway/status` – aktiver Standard-Anbieter und `tasks` (welche Aufgaben verfügbar sind)
- `POST /ai/gateway/complete` – `{ prompt, task?, context?, providerId? }` (Recht `ai.use`)
- `GET|POST /ai/providers`, `PATCH|DELETE /ai/providers/:id`, `POST /ai/providers/:id/test`
  (Recht `system.settings.write`; Test zusätzlich `ai.use`), mit `capabilities: ["text", "vision", "image"]`
- `GET /ai/tasks`, `PUT /ai/tasks/:task` – `{ providerId | null, model? }` (Recht `system.settings.write`)
- `POST /ai/assist/quote-text` – `{ projectId, lines: [{ serviceId? | description?, quantity?, unit? }], hint? }`
  (Rechte `ai.use` und `quote.create`)
- `POST /ai/assist/site-summary` – `{ projectId }` (Rechte `ai.use` und `site.use`)
- `POST /ai/assist/photo-description` – `{ documentId }` eines Baustellenfotos (Rechte `ai.use` und `site.use`)
- `POST /ai/assist/plans/:planId/drawing` – `{ instruction, objects?, unitsPerMeter? }` → `{ objects,
  dropped, image, note }` (Rechte `ai.use` und `plan.write`; nichts wird gespeichert)
- `POST /finance/payables/documents/:documentId/ai-read` – Vorschlag fürs Formular (Rechte
  `finance.read` und `ai.use`)
