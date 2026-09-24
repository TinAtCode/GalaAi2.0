// Jeder KI-Anbieter implementiert diese eine Schnittstelle – eine
// OpenAI-kompatible API (auch selbst gehostet), Anthropic oder ein eigener
// Agent. Das ist der ganze Vertrag zwischen GartenAI und „irgendeiner“ KI;
// kein Modul außerhalb dieses Gateways ruft einen Anbieter direkt auf.
export interface AiCompletionRequest {
  prompt: string;
  // Wofür (z.B. "angebotstext", "test") – für den Agenten und das Protokoll
  task?: string;
  // Bereits nach den Rechten des Anfragenden gefilterter Kontext: die KI
  // sieht nie mehr als der Mensch, der fragt (siehe context-filter.ts)
  context?: Record<string, unknown>;
  // Wer fragt (nur für eigene Agenten: Firma, Nutzer, Rechte)
  caller?: { companyId: string; userId: string; permissions: string[] };
}

export interface AiCompletionResult {
  text: string;
  providerName: string;
  model?: string;
  // strukturierte Zusatzdaten eines eigenen Agenten (z.B. Vorschläge)
  data?: Record<string, unknown>;
  raw?: unknown;
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

// Fehler des Anbieters (nicht erreichbar, Zeitüberschreitung, falsche Antwort)
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
