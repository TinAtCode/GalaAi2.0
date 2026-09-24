import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

// Metriken im Prometheus-Format (GET /metrics). Eine eigene Registry statt
// der globalen, damit Tests mit mehreren App-Instanzen im selben Prozess
// nichts doppelt registrieren.
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP-Anfragen nach Methode, Route und Status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

// Grenzen der Dauer-Buckets; der Verlauf (metrics-history) speichert je Minute
// die Anzahl je Bucket, plus einen letzten für alles darüber (+Inf)
export const LATENCY_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Dauer der HTTP-Anfragen in Sekunden',
  labelNames: ['method', 'route'] as const,
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

export const ocrQueueRunning = new Gauge({
  name: 'ocr_queue_running',
  help: 'Gerade laufende Texterkennungen',
  registers: [registry],
});

export const ocrQueueWaiting = new Gauge({
  name: 'ocr_queue_waiting',
  help: 'Wartende Texterkennungen',
  registers: [registry],
});

export const mailSendFailures = new Counter({
  name: 'mail_send_failures_total',
  help: 'Fehlgeschlagene E-Mail-Versendungen',
  registers: [registry],
});

// Label ist das Routen-Muster (/customers/:id), nie der echte Pfad: sonst
// entstünde pro ID eine eigene Zeitreihe, und IDs landeten im Monitoring.
export function httpMetrics(req: Request, res: Response, next: NextFunction) {
  const stop = httpDuration.startTimer();
  res.on('finish', () => {
    const pattern = (req.route as { path?: string } | undefined)?.path;
    const route = typeof pattern === 'string' ? `${req.baseUrl}${pattern}` : 'unmatched';
    if (route.startsWith('/metrics') || route === '/health') return;
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    stop({ method: req.method, route });
  });
  next();
}

export interface CounterSnapshot {
  requests: number;
  serverErrors: number;
  // kumuliert wie in Prometheus: Anfragen bis zur jeweiligen Grenze, zuletzt alle
  latencyCumulative: number[];
  mailFailures: number;
}

// Zählerstände dieses Prozesses (über alle Routen) – der Verlauf speichert je
// Minute die Differenz zweier Stände
export async function snapshotCounters(): Promise<CounterSnapshot> {
  const requests = (await httpRequests.get()).values;
  const latencyCumulative = new Array<number>(LATENCY_BUCKETS.length + 1).fill(0);
  for (const { metricName, labels, value } of (await httpDuration.get()).values) {
    if (!metricName?.endsWith('_bucket')) continue;
    const le = (labels as { le?: string | number }).le;
    const index = le === '+Inf' ? LATENCY_BUCKETS.length : LATENCY_BUCKETS.indexOf(Number(le));
    if (index >= 0) latencyCumulative[index] += value;
  }
  return {
    requests: requests.reduce((sum, v) => sum + v.value, 0),
    serverErrors: requests
      .filter((v) => String(v.labels.status).startsWith('5'))
      .reduce((sum, v) => sum + v.value, 0),
    latencyCumulative,
    mailFailures: (await mailSendFailures.get()).values.reduce((sum, v) => sum + v.value, 0),
  };
}

export async function ocrWaitingNow() {
  return (await ocrQueueWaiting.get()).values[0]?.value ?? 0;
}
