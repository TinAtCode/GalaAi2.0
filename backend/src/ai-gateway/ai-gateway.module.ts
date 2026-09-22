import { Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AI_PROVIDER } from './ai-provider.interface';
import { NoopAiProvider } from './providers/noop-provider';

// Anbieterwechsel = genau diese eine Zeile ändern (provider.useClass), oder
// die Klasse gegen einen `useFactory` tauschen, der z.B. anhand einer
// Umgebungsvariable ANTHROPIC_API_KEY entscheidet, welcher Adapter geladen
// wird. Kein anderer Teil der Anwendung muss dafür angefasst werden.
@Module({
  controllers: [AiGatewayController],
  providers: [AiGatewayService, { provide: AI_PROVIDER, useClass: NoopAiProvider }],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
