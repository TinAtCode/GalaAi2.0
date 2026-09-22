import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AI_PROVIDER, AiCompletionRequest, AiCompletionResult, AiProvider } from './ai-provider.interface';

@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(AI_PROVIDER) private provider: AiProvider,
    private prisma: PrismaService,
  ) {}

  // Einziger Ort, an dem ein KI-Anbieter aufgerufen wird. Jeder Aufruf wird
  // protokolliert (Punkt 36: Audit-Log mit "KI ja/nein"), unabhängig davon,
  // welcher Anbieter gerade dahintersteckt.
  async complete(
    companyId: string,
    userId: string,
    request: AiCompletionRequest,
  ): Promise<AiCompletionResult> {
    const result = await this.provider.complete(request);

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'ai_completion',
        entity: 'AiGateway',
        newData: { prompt: request.prompt, providerName: result.providerName },
        source: 'ai',
      },
    });

    return result;
  }

  // Für Diagnose/Frontend: welcher Anbieter ist gerade aktiv?
  getActiveProviderName(): string {
    return this.provider.name;
  }
}
