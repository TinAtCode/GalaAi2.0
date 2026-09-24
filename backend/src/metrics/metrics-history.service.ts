import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { monitorEventLoopDelay } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INSTANCE_ID } from '../ocr/ocr-queue';
import { CounterSnapshot, ocrWaitingNow, snapshotCounters } from './metrics';
import { thresholdReport } from './thresholds';

// Messpunkte der letzten `days` Tage (1–365)
export async function loadSamples(prisma: PrismaClient, days: number) {
  const span = Math.min(365, Math.max(1, Math.floor(days) || 28));
  return prisma.metricSample.findMany({
    where: { at: { gte: new Date(Date.now() - span * 86_400_000) } },
    orderBy: { at: 'asc' },
  });
}

export async function reportForDays(prisma: PrismaClient, days: number) {
  return thresholdReport(await loadSamples(prisma, days));
}

const FLUSH_MS = 60_000;
const SAMPLE_MS = 10_000;

// Verlauf der Betriebswerte: jede Minute ein Messpunkt je Server in der
// Datenbank (MetricSample) – Anfragen, Serverfehler, Antwortzeiten,
// OCR-Warteschlange, Event-Loop, Speicher, fehlgeschlagene E-Mails. Daraus
// schlägt `alert-thresholds` (bzw. GET /metrics/history) nach einigen Wochen
// Betrieb Alarmschwellen vor. Läuft ohne Prometheus; METRICS_HISTORY=off
// schaltet es ab, METRICS_HISTORY_DAYS (Standard 90) bestimmt die Aufbewahrung.
@Injectable()
export class MetricsHistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsHistoryService.name);
  private timers: NodeJS.Timeout[] = [];
  private previous?: CounterSnapshot;
  private lag = monitorEventLoopDelay({ resolution: 20 });
  private maxRss = 0;
  private maxOcrWaiting = 0;
  private flushes = 0;

  constructor(private prisma: PrismaService) {}

  static get enabled() {
    const setting = process.env.METRICS_HISTORY;
    return setting ? setting !== 'off' : process.env.NODE_ENV !== 'test';
  }

  static get retentionDays() {
    return Math.max(1, Number(process.env.METRICS_HISTORY_DAYS) || 90);
  }

  async onModuleInit() {
    if (!MetricsHistoryService.enabled) return;
    this.lag.enable();
    this.previous = await snapshotCounters();
    await this.sample();
    const flush = setInterval(
      () =>
        void this.flush().catch((err: Error) =>
          this.logger.warn({ msg: 'Messpunkt nicht gespeichert', error: err.message }),
        ),
      FLUSH_MS,
    );
    const sample = setInterval(() => void this.sample().catch(() => undefined), SAMPLE_MS);
    this.timers = [flush, sample];
    this.timers.forEach((timer) => timer.unref?.());
    void this.prune().catch(() => undefined);
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.lag.disable();
  }

  // Momentwerte: der höchste Wert der Minute zählt
  async sample() {
    this.maxRss = Math.max(this.maxRss, process.memoryUsage().rss);
    this.maxOcrWaiting = Math.max(this.maxOcrWaiting, await ocrWaitingNow());
  }

  // Messpunkt seit dem letzten Aufruf speichern (der erste Aufruf setzt nur den Ausgangsstand)
  async flush() {
    await this.sample();
    const current = await snapshotCounters();
    const previous = this.previous;
    this.previous = current;
    if (!previous) return null;

    const cumulative = current.latencyCumulative.map((n, i) => n - previous.latencyCumulative[i]);
    const latencyBuckets = cumulative.map((n, i) => Math.max(0, n - (i > 0 ? cumulative[i - 1] : 0)));
    const lag = this.lag.percentile(99) / 1e9;
    this.lag.reset();
    const data = {
      instance: INSTANCE_ID,
      requests: current.requests - previous.requests,
      serverErrors: current.serverErrors - previous.serverErrors,
      latencyBuckets,
      eventLoopP99Seconds: Number.isFinite(lag) ? lag : 0,
      rssBytes: this.maxRss,
      ocrWaiting: this.maxOcrWaiting,
      mailFailures: current.mailFailures - previous.mailFailures,
    };
    this.maxRss = 0;
    this.maxOcrWaiting = 0;
    const saved = await this.prisma.metricSample.create({ data });
    if (++this.flushes % 60 === 0) await this.prune();
    return saved;
  }

  async prune() {
    const before = new Date(Date.now() - MetricsHistoryService.retentionDays * 86_400_000);
    await this.prisma.metricSample.deleteMany({ where: { at: { lt: before } } });
  }
}
