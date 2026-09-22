// Jeder KI-Anbieter (Anthropic, OpenAI, ein eigener API-Key, später ein
// lokales Modell) implementiert diese eine Schnittstelle. Das ist der ganze
// Vertrag zwischen GartenAI und "irgendeiner" KI – kein Modul außerhalb
// dieses Gateways darf einen Anbieter direkt aufrufen (Punkt 10).
export interface AiCompletionRequest {
  prompt: string;
  // Bereits VOR dem Aufruf permission-gefilterter Kontext (siehe Punkt 13:
  // die KI darf niemals mehr Daten sehen als der anfragende User selbst).
  context?: Record<string, unknown>;
}

export interface AiCompletionResult {
  text: string;
  providerName: string;
  // Für Audit-Zwecke (Punkt 36: "KI ja/nein" im Protokoll) und Debugging.
  raw?: unknown;
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

// Injection-Token für Nest's DI-Container. Ein neuer Anbieter wird
// eingebunden, indem im AiGatewayModule dieser Token auf eine andere
// AiProvider-Implementierung gebunden wird – der Rest der Anwendung merkt
// davon nichts.
export const AI_PROVIDER = Symbol('AI_PROVIDER');
