import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertTenantFilter } from './tenant-guard';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Gilt für alle Abfragen, auch innerhalb von Transaktionen (siehe tenant-guard.ts).
    // Hinweis: $use entfällt mit Prisma 6 – dann als Client-Extension umsetzen.
    this.$use((params, next) => {
      assertTenantFilter(params);
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
