import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');
const REQUEST_ID = /^[\w.-]{1,64}$/;

// Eine Zeile pro Anfrage: Methode, Pfad (ohne Query – dort können Namen oder
// Suchbegriffe stehen), Status, Dauer, Nutzer und Request-ID. Nie Bodies,
// Cookies oder Tokens. Die Request-ID kommt vom Proxy (X-Request-Id) oder
// wird erzeugt und in der Antwort zurückgegeben – so lässt sich eine
// Fehlermeldung eines Nutzers im Log wiederfinden.
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.path === '/health') return; // Health-Checks laufen im Sekundentakt
    const user = req.user as { userId?: string; companyId?: string } | undefined;
    const entry = {
      msg: `${req.method} ${req.path} ${res.statusCode}`,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      requestId,
      ...(user?.userId ? { userId: user.userId, companyId: user.companyId } : {}),
    };
    if (res.statusCode >= 500) logger.error(entry);
    else if (res.statusCode >= 400) logger.warn(entry);
    else logger.log(entry);
  });
  next();
}
