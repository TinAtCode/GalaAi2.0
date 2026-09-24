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
  "systemPrompt": "optional, aus der Einrichtung"
}
```

Kopfzeilen:

- `X-GartenAI-Timestamp`: Unix-Zeit in Sekunden
- mit Schlüssel zusätzlich `Authorization: Bearer <Schlüssel>` und
  `X-GartenAI-Signature: sha256=<HMAC-SHA256(Schlüssel, "<Timestamp>.<Inhalt>") als Hex>`

Der Agent sollte die Signatur prüfen und Anfragen verwerfen, deren Zeitstempel älter als ein paar
Minuten ist. `task` sagt, wofür gefragt wird: `verbindungstest` beim Testen-Knopf, `frage` für freie
Fragen, weitere Aufgaben kommen mit den Funktionen der App dazu.

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

- `GET /ai/gateway/status` – aktiver Standard-Anbieter
- `POST /ai/gateway/complete` – `{ prompt, task?, context?, providerId? }` (Recht `ai.use`)
- `GET|POST /ai/providers`, `PATCH|DELETE /ai/providers/:id`, `POST /ai/providers/:id/test`
  (Recht `system.settings.write`; Test zusätzlich `ai.use`)
