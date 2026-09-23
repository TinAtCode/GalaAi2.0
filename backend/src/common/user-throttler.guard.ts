import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { getJwtSecret } from '../auth/jwt-secret';
import { sessionTokenFromCookie } from '../auth/session-cookie';

// Allgemeines Anfrage-Limit: angemeldete Anfragen zählen je Nutzer, alle
// anderen je IP. Sonst teilen sich alle Mitarbeiter eines Büros (eine
// gemeinsame IP hinter dem Router) ein einziges Kontingent. Gezählt wird
// ein Nutzer nur mit gültig signiertem Token – ein erfundenes Token landet
// wieder beim IP-Limit. Der Login zählt immer je IP (auth/login-throttle.ts).
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private jwt?: JwtService;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const request = req as Request;
    const isLogin = request.method === 'POST' && request.route?.path === '/auth/login';
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : sessionTokenFromCookie(request);
    if (token && !isLogin) {
      try {
        this.jwt ??= new JwtService({ secret: getJwtSecret() });
        const { sub } = this.jwt.verify<{ sub: string }>(token);
        if (sub) return `user:${sub}`;
      } catch {
        // ungültig oder abgelaufen -> wie anonym behandeln
      }
    }
    return super.getTracker(req);
  }
}

// Anfragen je Minute und Nutzer bzw. IP. Nur für automatisierte Tests erhöhen.
export const requestRateLimit = () => Number(process.env.RATE_LIMIT) || 300;
