import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../common/authenticated-request';
import { getJwtSecret } from './jwt-secret';
import { PrismaService } from '../prisma/prisma.service';
import { loadUserWithPermissions } from './permissions-of-user';

interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  tv?: number; // tokenVersion zum Zeitpunkt der Ausstellung
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Rückgabewert landet als req.user. companyId kommt ausschließlich von
  // hier (aus dem signierten Token) – nie aus Client-Eingaben.
  // Pro Anfrage wird der User live geladen: deaktivierte Konten und Tokens
  // von vor einer Passwortänderung werden sofort abgewiesen, und die Rechte
  // entsprechen immer den aktuellen Rollen.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const found = await loadUserWithPermissions(this.prisma, { id: payload.sub });
    if (
      !found ||
      !found.user.active ||
      found.user.companyId !== payload.companyId ||
      found.user.tokenVersion !== (payload.tv ?? 0)
    ) {
      throw new UnauthorizedException('Sitzung ist nicht mehr gültig.');
    }
    return {
      userId: found.user.id,
      companyId: found.user.companyId,
      email: found.user.email,
      permissions: found.permissions,
    };
  }
}
