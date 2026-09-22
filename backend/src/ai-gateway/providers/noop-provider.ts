import { Injectable } from '@nestjs/common';
import { AiCompletionRequest, AiCompletionResult, AiProvider } from '../ai-provider.interface';

// Läuft ohne jede externe Abhängigkeit oder API-Key. Gibt IMMER eine klare,
// deterministische Antwort zurück statt eine KI vorzutäuschen – so kann das
// Gateway (Routing, Berechtigungsprüfung, Audit-Log) vollständig entwickelt
// und getestet werden, bevor eine Entscheidung für einen echten Anbieter
// getroffen ist. Sobald ein Anbieter feststeht, wird diese Klasse einfach
// durch eine echte Implementierung derselben AiProvider-Schnittstelle
// ersetzt (siehe AI_PROVIDER-Token in ai-gateway.module.ts).
@Injectable()
export class NoopAiProvider implements AiProvider {
  readonly name = 'none';

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    return {
      text: 'Es ist aktuell kein KI-Anbieter konfiguriert. Diese Antwort kommt vom Platzhalter-Adapter (NoopAiProvider) und wurde nicht von einer echten KI erzeugt.',
      providerName: this.name,
      raw: { receivedPrompt: request.prompt },
    };
  }
}
