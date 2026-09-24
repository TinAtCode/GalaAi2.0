import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { registry } from './metrics';
import { reportForDays } from './metrics-history.service';
import { formatReport } from './thresholds';

const digest = (value: string) => createHash('sha256').update(value).digest();

function checkToken(authorization: string | undefined) {
  const token = process.env.METRICS_TOKEN;
  if (!token) throw new NotFoundException();
  const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!timingSafeEqual(digest(given), digest(token))) throw new UnauthorizedException();
}

// Für Prometheus: ohne Login, aber nur mit METRICS_TOKEN als Bearer-Token.
// Ohne eingestelltes Token ist der Endpunkt aus (404) – Metriken verraten
// Auslastung und Routen und gehören nicht ins offene Internet.
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    checkToken(authorization);
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }

  // Auswertung des Verlaufs mit Vorschlägen für die Alarmschwellen
  // (?days=28, ?format=text für den lesbaren Bericht)
  @Get('history')
  async history(
    @Headers('authorization') authorization: string | undefined,
    @Query('days') days: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    checkToken(authorization);
    const report = await reportForDays(this.prisma, Number(days) || 28);
    if (format === 'text') {
      res.type('text/plain; charset=utf-8').send(formatReport(report));
      return;
    }
    res.json(report);
  }
}
