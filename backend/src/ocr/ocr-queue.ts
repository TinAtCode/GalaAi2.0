import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { ocrQueueRunning, ocrQueueWaiting } from '../metrics/metrics';

// Begrenzt, wie viele Texterkennungen gleichzeitig laufen – über alle
// Server-Instanzen zusammen. OCR ist rechen- und speicherintensiv; ohne Grenze
// würden einige große Scans den ganzen Betrieb ausbremsen. OCR_CONCURRENCY
// (Standard 2) Plätze liegen in der Datenbank (OcrSlot); ein Platz gehört
// seinem Halter, solange er ihn alle 30 Sekunden verlängert. Stürzt ein Server
// ab, wird sein Platz nach 2 Minuten wieder frei.

export const INSTANCE_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
export const LEASE_SECONDS = 120;
const HEARTBEAT_MS = 30_000;

export interface SlotStore {
  acquire(holder: string, limit: number): Promise<boolean>;
  renew(holder: string): Promise<void>;
  release(holder: string): Promise<void>;
}

// Plätze im Speicher (Tests, oder ein einzelner Server ohne Datenbank-Plätze)
export class MemorySlotStore implements SlotStore {
  private holders = new Set<string>();
  async acquire(holder: string, limit: number) {
    if (this.holders.size >= limit) return false;
    this.holders.add(holder);
    return true;
  }
  async renew() {}
  async release(holder: string) {
    this.holders.delete(holder);
  }
}

@Injectable()
export class PrismaSlotStore implements SlotStore {
  constructor(private prisma: PrismaService) {}

  // Plätze bei Bedarf anlegen; dann den ersten freien (oder abgelaufenen)
  // Platz belegen. SKIP LOCKED: gleichzeitige Anfragen anderer Server warten
  // nicht aufeinander und bekommen nie denselben Platz.
  async acquire(holder: string, limit: number) {
    await this.prisma.$executeRaw`
      INSERT INTO "OcrSlot" (id) SELECT generate_series(1, ${limit}::int) ON CONFLICT DO NOTHING`;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE "OcrSlot" SET holder = ${holder}, "leasedUntil" = NOW() + make_interval(secs => ${LEASE_SECONDS})
      WHERE id = (
        SELECT id FROM "OcrSlot"
        WHERE id <= ${limit}::int AND (holder IS NULL OR "leasedUntil" < NOW())
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.length > 0;
  }

  async renew(holder: string) {
    await this.prisma.$executeRaw`
      UPDATE "OcrSlot" SET "leasedUntil" = NOW() + make_interval(secs => ${LEASE_SECONDS}) WHERE holder = ${holder}`;
  }

  async release(holder: string) {
    await this.prisma
      .$executeRaw`UPDATE "OcrSlot" SET holder = NULL, "leasedUntil" = NULL WHERE holder = ${holder}`;
  }
}

export const OCR_SLOT_STORE = 'OCR_SLOT_STORE';

@Injectable()
export class OcrQueue {
  private running = 0;
  private waitingGlobal = 0;
  private waiting: (() => void)[] = [];

  constructor(@Optional() @Inject(OCR_SLOT_STORE) private store: SlotStore = new MemorySlotStore()) {}

  get limit() {
    return Math.max(1, Number(process.env.OCR_CONCURRENCY) || 2);
  }

  // Wartezeit zwischen zwei Versuchen, einen Platz zu bekommen
  private get pollMs() {
    return Math.max(10, Number(process.env.OCR_SLOT_POLL_MS) || 500);
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length + this.waitingGlobal };
  }

  // onHeartbeat: wird alle 30 s aufgerufen, solange der Auftrag wartet oder läuft
  async run<T>(task: () => Promise<T>, onHeartbeat?: () => Promise<unknown>): Promise<T> {
    const holder = `${INSTANCE_ID}:${randomUUID()}`;
    let holding = false;
    const beat = setInterval(() => {
      if (holding) void this.store.renew(holder).catch(() => undefined);
      void onHeartbeat?.().catch(() => undefined);
    }, HEARTBEAT_MS);
    beat.unref?.();
    let localTurn = false;
    try {
      // 1. auf diesem Server der Reihe nach
      if (this.running + this.waitingGlobal >= this.limit) {
        const turn = new Promise<void>((resolve) => this.waiting.push(resolve));
        this.report();
        await turn;
      }
      localTurn = true;
      // 2. freier Platz über alle Server
      this.waitingGlobal++;
      this.report();
      try {
        while (!(await this.store.acquire(holder, this.limit))) {
          await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        }
      } finally {
        this.waitingGlobal--;
      }
      holding = true;
      this.running++;
      this.report();
      return await task();
    } finally {
      clearInterval(beat);
      if (holding) {
        this.running--;
        await this.store.release(holder).catch(() => undefined);
      }
      if (localTurn) this.waiting.shift()?.();
      this.report();
    }
  }

  private report() {
    ocrQueueRunning.set(this.running);
    ocrQueueWaiting.set(this.stats.waiting);
  }
}
