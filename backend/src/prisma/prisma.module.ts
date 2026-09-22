import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global, damit jedes Feature-Modul die PrismaService injizieren kann,
// ohne PrismaModule jedes Mal einzeln zu importieren.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
