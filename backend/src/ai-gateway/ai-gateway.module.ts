import { Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiAssistService } from './ai-assist.service';

// Anbieter werden je Firma in den Einstellungen eingerichtet (AiProviderConfig),
// nicht im Code: OpenAI-kompatibel (auch selbst gehostet), Anthropic oder ein
// eigener Agent. Ohne Einrichtung antwortet der Platzhalter (NoopAiProvider).
@Module({
  controllers: [AiGatewayController],
  providers: [AiGatewayService, AiAssistService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
