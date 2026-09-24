import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { AiProviderError } from '../src/ai-gateway/ai-provider.interface';
import { filterContext } from '../src/ai-gateway/context-filter';
import {
  AgentProvider,
  agentSignature,
  AnthropicProvider,
  OpenAiCompatibleProvider,
  ProviderSettings,
} from '../src/ai-gateway/providers/configured-providers';
import { assertProviderUrl } from '../src/ai-gateway/providers/http';
import { NoopAiProvider } from '../src/ai-gateway/providers/noop-provider';

// Nachgebaute Anbieter auf einem echten lokalen HTTP-Server: prüft die
// Formate auf der Leitung (Pfad, Kopfzeilen, Inhalt) statt nur Aufrufe.
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

describe('KI-Anbieter', () => {
  let server: Server;
  let base: string;
  let handler: Handler;
  const seen: { path?: string; headers: IncomingMessage['headers']; body: any }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen.push({ path: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
        handler(req, body, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    seen.length = 0;
  });

  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const settings = (patch: Partial<ProviderSettings> = {}): ProviderSettings => ({
    name: 'Test',
    baseUrl: `${base}/v1`,
    model: 'llama3.1',
    apiKey: 'sk-test',
    timeoutSeconds: 5,
    maxTokens: 256,
    systemPrompt: null,
    ...patch,
  });

  it('OpenAI-kompatibel (Ollama, LM Studio, vLLM …): /chat/completions mit Bearer', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, { model: 'llama3.1:8b', choices: [{ message: { content: 'Hallo' } }] });
    const result = await new OpenAiCompatibleProvider(settings({ baseUrl: `${base}/v1/` })).complete({
      prompt: 'Frage',
      context: { projekt: 'Hecke' },
    });
    expect(result).toMatchObject({ text: 'Hallo', providerName: 'Test', model: 'llama3.1:8b' });
    expect(seen[0].path).toBe('/v1/chat/completions');
    expect(seen[0].headers.authorization).toBe('Bearer sk-test');
    expect(seen[0].body).toMatchObject({ model: 'llama3.1', max_tokens: 256 });
    expect(seen[0].body.messages[0].role).toBe('system');
    expect(seen[0].body.messages[1].content).toContain('"projekt": "Hecke"');

    // ohne Schlüssel (lokales Ollama): keine Authorization-Zeile
    await new OpenAiCompatibleProvider(settings({ apiKey: null })).complete({ prompt: 'x' });
    expect(seen[1].headers.authorization).toBeUndefined();
  });

  it('Anthropic: /v1/messages mit x-api-key und Version', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, {
        model: 'claude-x',
        content: [
          { type: 'text', text: 'Guten ' },
          { type: 'text', text: 'Tag' },
        ],
      });
    const result = await new AnthropicProvider(settings({ baseUrl: base, model: 'claude-x' })).complete({
      prompt: 'Hi',
    });
    expect(result.text).toBe('Guten Tag');
    expect(seen[0].path).toBe('/v1/messages');
    expect(seen[0].headers['x-api-key']).toBe('sk-test');
    expect(seen[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(seen[0].body).toMatchObject({
      model: 'claude-x',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(typeof seen[0].body.system).toBe('string');
  });

  it('eigener Agent: Vertrag v1, Signatur prüfbar, strukturierte Daten zurück', async () => {
    let signatureOk = false;
    handler = (req, body, res) => {
      const timestamp = req.headers['x-gartenai-timestamp'] as string;
      signatureOk = req.headers['x-gartenai-signature'] === agentSignature('sk-test', timestamp, body);
      json(res, 200, { text: 'Vorschlag', data: { positionen: 2 } });
    };
    const caller = { companyId: 'c1', userId: 'u1', permissions: ['ai.use'] };
    const result = await new AgentProvider(settings({ baseUrl: `${base}/agent` })).complete({
      prompt: 'Angebotstext',
      task: 'angebotstext',
      context: { a: 1 },
      caller,
    });
    expect(signatureOk).toBe(true);
    expect(result).toMatchObject({ text: 'Vorschlag', data: { positionen: 2 } });
    expect(seen[0].path).toBe('/agent');
    expect(seen[0].body).toMatchObject({
      version: 1,
      task: 'angebotstext',
      prompt: 'Angebotstext',
      context: { a: 1 },
      caller,
    });
  });

  it('Fehler des Anbieters werden verständlich', async () => {
    handler = (_req, _body, res) => json(res, 401, { error: { message: 'invalid api key' } });
    await expect(new OpenAiCompatibleProvider(settings()).complete({ prompt: 'x' })).rejects.toThrow(
      'Fehler 401: invalid api key',
    );
    handler = (_req, _body, res) => json(res, 200, { unerwartet: true });
    await expect(new AgentProvider(settings({ baseUrl: base })).complete({ prompt: 'x' })).rejects.toThrow(
      /Feld „text“/,
    );
    handler = () => undefined; // antwortet nie
    await expect(
      new OpenAiCompatibleProvider(settings({ timeoutSeconds: 1 })).complete({ prompt: 'x' }),
    ).rejects.toThrow(/innerhalb von 1 Sekunden/);
    await expect(
      new OpenAiCompatibleProvider(settings({ baseUrl: 'http://127.0.0.1:1/v1' })).complete({ prompt: 'x' }),
    ).rejects.toThrow(AiProviderError);
    // Weiterleitungen werden nicht verfolgt
    handler = (_req, _body, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/' });
      res.end();
    };
    await expect(new OpenAiCompatibleProvider(settings()).complete({ prompt: 'x' })).rejects.toThrow(
      AiProviderError,
    );
  });

  it('Adressen: eigenes Netz erlaubt, Metadaten-Dienste gesperrt', async () => {
    await expect(assertProviderUrl('http://192.168.1.20:11434/v1')).resolves.toBeTruthy();
    await expect(assertProviderUrl('http://localhost:1234/v1')).resolves.toBeTruthy();
    await expect(assertProviderUrl('http://169.254.169.254/latest')).rejects.toThrow(/gesperrt/);
    await expect(assertProviderUrl('http://[fe80::1]/')).rejects.toThrow(/gesperrt/);
    await expect(assertProviderUrl('http://metadata.google.internal/')).rejects.toThrow(/gesperrt/);
    await expect(assertProviderUrl('ftp://example.com')).rejects.toThrow(/http/);
    await expect(assertProviderUrl('http://user:pw@example.com')).rejects.toThrow(/API-Schlüssel/);
    process.env.AI_BLOCK_PRIVATE_NETWORKS = '1';
    try {
      await expect(assertProviderUrl('http://192.168.1.20/v1')).rejects.toThrow(/gesperrt/);
      await expect(assertProviderUrl('http://127.0.0.1/v1')).rejects.toThrow(/gesperrt/);
    } finally {
      delete process.env.AI_BLOCK_PRIVATE_NETWORKS;
    }
  });

  it('Kontext: ohne Recht keine Einkaufspreise, Margen oder Löhne', () => {
    const context = {
      article: { name: 'Kies', salePrice: 32, purchasePrice: 21.5, unitCost: 20 },
      lines: [{ margin: 0.3, total: 100 }],
      employee: { name: 'Max', hourlyRate: 25 },
    };
    expect(filterContext(context, [])).toEqual({
      article: { name: 'Kies', salePrice: 32 },
      lines: [{ total: 100 }],
      employee: { name: 'Max' },
    });
    expect(
      filterContext(context, ['price.purchase.read', 'price.margin.read', 'employee.data.read']),
    ).toEqual(context);
  });

  it('ohne Einrichtung: klare Platzhalter-Antwort', async () => {
    const result = await new NoopAiProvider().complete({ prompt: 'x' });
    expect(result.providerName).toBe('none');
    expect(result.text).toContain('kein KI-Anbieter konfiguriert');
  });
});
