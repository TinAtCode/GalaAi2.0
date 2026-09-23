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

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Dauer der HTTP-Anfragen in Sekunden',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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
    if (route === '/metrics' || route === '/health') return;
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    stop({ method: req.method, route });
  });
  next();
}
