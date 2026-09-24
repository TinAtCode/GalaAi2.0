import { Global, Module } from '@nestjs/common';
import { PUSH_SENDER, WebPushSender } from './push-sender';
import { PushController } from './push.controller';
import { PushService } from './push.service';

// Global: Termine und Baustelle schicken darüber Nachrichten
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PUSH_SENDER, useClass: WebPushSender }],
  exports: [PushService],
})
export class PushModule {}
