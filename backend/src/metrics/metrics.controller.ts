import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { registry } from './metrics';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Für Prometheus: ohne Login, aber nur mit METRICS_TOKEN als Bearer-Token.
// Ohne eingestelltes Token ist der Endpunkt aus (404) – Metriken verraten
// Auslastung und Routen und gehören nicht ins offene Internet.
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!timingSafeEqual(digest(given), digest(token))) throw new UnauthorizedException();
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
