import { createHmac } from 'crypto';
import {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
  AiProviderError,
} from '../ai-provider.interface';
import { postJson } from './http';

// Einstellungen eines Anbieters, wie sie in AiProviderConfig stehen (Schlüssel entschlüsselt)
export interface ProviderSettings {
  name: string;
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  timeoutSeconds: number;
  maxTokens: number;
  systemPrompt: string | null;
}

const DEFAULT_SYSTEM =
  'Du bist der Assistent von GartenAI, einer Software für Garten- und Landschaftsbaubetriebe. Antworte auf Deutsch, knapp und sachlich.';

// Kontext als Textblock an die Frage hängen (für Sprachmodelle)
function userMessage(request: AiCompletionRequest) {
  if (!request.context || !Object.keys(request.context).length) return request.prompt;
  return `${request.prompt}\n\nDaten aus GartenAI (JSON):\n${JSON.stringify(request.context, null, 2)}`;
}

// Nachricht mit Bildern im Format des jeweiligen Anbieters
function openAiContent(request: AiCompletionRequest) {
  const text = userMessage(request);
  if (!request.images?.length) return text;
  return [
    { type: 'text', text },
    ...request.images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mediaType};base64,${image.data}` },
    })),
  ];
}

function anthropicContent(request: AiCompletionRequest) {
  const text = userMessage(request);
  if (!request.images?.length) return text;
  return [
    ...request.images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    })),
    { type: 'text', text },
  ];
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

// OpenAI-kompatible Chat-API: OpenAI, OpenRouter, Mistral, Azure-Proxys und
// selbst gehostet Ollama (http://rechner:11434/v1), LM Studio
// (http://rechner:1234/v1), vLLM, LocalAI. Basisadresse bis einschließlich /v1.
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private settings: ProviderSettings) {}
  get name() {
    return this.settings.name;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const s = this.settings;
    if (!s.model) throw new AiProviderError('Kein Modell eingestellt.');
    const json = (await postJson(
      `${trimSlash(s.baseUrl)}/chat/completions`,
      {
        model: s.model,
        max_tokens: s.maxTokens,
        messages: [
          { role: 'system', content: s.systemPrompt || DEFAULT_SYSTEM },
          { role: 'user', content: openAiContent(request) },
        ],
      },
      { timeoutSeconds: s.timeoutSeconds, headers: s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {} },
    )) as { choices?: { message?: { content?: unknown } }[]; model?: string };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string')
      throw new AiProviderError('Unerwartete Antwort (choices[0].message.content fehlt).');
    return { text, providerName: s.name, model: json.model ?? s.model };
  }
}

// Anthropic Messages API (Claude). Basisadresse leer = https://api.anthropic.com
export class AnthropicProvider implements AiProvider {
  constructor(private settings: ProviderSettings) {}
  get name() {
    return this.settings.name;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const s = this.settings;
    if (!s.model) throw new AiProviderError('Kein Modell eingestellt.');
    if (!s.apiKey) throw new AiProviderError('Kein API-Schlüssel hinterlegt.');
    const json = (await postJson(
      `${trimSlash(s.baseUrl || 'https://api.anthropic.com')}/v1/messages`,
      {
        model: s.model,
        max_tokens: s.maxTokens,
        system: s.systemPrompt || DEFAULT_SYSTEM,
        messages: [{ role: 'user', content: anthropicContent(request) }],
      },
      {
        timeoutSeconds: s.timeoutSeconds,
        headers: { 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
      },
    )) as { content?: { type?: string; text?: unknown }[]; model?: string };
    const text = (json.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
    if (!text) throw new AiProviderError('Unerwartete Antwort (kein Text in content).');
    return { text, providerName: s.name, model: json.model ?? s.model };
  }
}

// Eigener Agent: ein beliebiger HTTP-Dienst nach dem GartenAI-Agentenvertrag
// (KI-ANBINDUNG.md). GartenAI schickt Aufgabe, Frage, gefilterten Kontext und
// wer fragt; der Agent antwortet mit { text, data? }. Mit Schlüssel kommt
// Authorization: Bearer <Schlüssel> und eine HMAC-Signatur über Zeitstempel
// und Inhalt, damit der Agent prüfen kann, dass die Anfrage von GartenAI kommt.
export const AGENT_PROTOCOL_VERSION = 1;

export function agentSignature(key: string, timestamp: string, body: string) {
  return `sha256=${createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex')}`;
}

export class AgentProvider implements AiProvider {
  constructor(private settings: ProviderSettings) {}
  get name() {
    return this.settings.name;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const s = this.settings;
    const body = JSON.stringify({
      version: AGENT_PROTOCOL_VERSION,
      task: request.task ?? 'frage',
      prompt: request.prompt,
      context: request.context ?? {},
      caller: request.caller ?? null,
      model: s.model,
      maxTokens: s.maxTokens,
      systemPrompt: s.systemPrompt,
      // Bilder als Anhänge (Base64), nur bei Aufgaben mit Bildern
      attachments: request.images ?? [],
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { 'X-GartenAI-Timestamp': timestamp };
    if (s.apiKey) {
      headers.Authorization = `Bearer ${s.apiKey}`;
      headers['X-GartenAI-Signature'] = agentSignature(s.apiKey, timestamp, body);
    }
    const json = (await postJson(s.baseUrl, null, {
      timeoutSeconds: s.timeoutSeconds,
      headers,
      rawBody: body,
    })) as {
      text?: unknown;
      data?: unknown;
      model?: unknown;
    };
    if (typeof json.text !== 'string')
      throw new AiProviderError('Unerwartete Antwort des Agenten (Feld „text“ fehlt).');
    const data =
      json.data && typeof json.data === 'object' && !Array.isArray(json.data)
        ? (json.data as Record<string, unknown>)
        : undefined;
    return {
      text: json.text,
      providerName: s.name,
      model: typeof json.model === 'string' ? json.model : (s.model ?? undefined),
      data,
    };
  }
}
