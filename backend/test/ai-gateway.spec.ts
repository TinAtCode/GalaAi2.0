import { AiGatewayService } from '../src/ai-gateway/ai-gateway.service';
import { NoopAiProvider } from '../src/ai-gateway/providers/noop-provider';
import { AiProvider, AiCompletionRequest, AiCompletionResult } from '../src/ai-gateway/ai-provider.interface';

function createPrismaMock() {
  const auditLogs: any[] = [];
  return {
    auditLog: {
      create: jest.fn(({ data }: any) => {
        auditLogs.push(data);
        return Promise.resolve(data);
      }),
    },
    __auditLogs: auditLogs,
  };
}

// Simuliert einen künftigen echten Anbieter (z.B. Anthropic), um zu
// beweisen, dass das Gateway wirklich gegen die Schnittstelle programmiert
// ist und nicht gegen eine konkrete Implementierung.
class FakeAnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    return { text: `Antwort auf: ${request.prompt}`, providerName: this.name };
  }
}

describe('AiGatewayService', () => {
  it('liefert mit dem Noop-Provider eine klare, deterministische Platzhalter-Antwort', async () => {
    const prisma = createPrismaMock();
    const service = new AiGatewayService(new NoopAiProvider(), prisma as any);

    const result = await service.complete('company-a', 'user-1', { prompt: 'Was steht heute an?' });

    expect(result.providerName).toBe('none');
    expect(result.text).toContain('kein KI-Anbieter konfiguriert');
    expect(service.getActiveProviderName()).toBe('none');
  });

  it('ist austauschbar: ein anderer Provider wird ohne Codeänderung im Gateway selbst genutzt', async () => {
    const prisma = createPrismaMock();
    const service = new AiGatewayService(new FakeAnthropicProvider(), prisma as any);

    const result = await service.complete('company-a', 'user-1', { prompt: 'Test' });

    expect(result.providerName).toBe('anthropic');
    expect(result.text).toBe('Antwort auf: Test');
  });

  it('protokolliert jeden Aufruf im Audit-Log mit source "ai"', async () => {
    const prisma = createPrismaMock();
    const service = new AiGatewayService(new NoopAiProvider(), prisma as any);

    await service.complete('company-a', 'user-1', { prompt: 'Welche Angebote sind offen?' });

    const logs = (prisma as any).__auditLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      companyId: 'company-a',
      userId: 'user-1',
      action: 'ai_completion',
      source: 'ai',
    });
  });
});
