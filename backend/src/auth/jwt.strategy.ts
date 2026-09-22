import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../common/authenticated-request';

interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    });
  }

  // Rückgabewert landet als req.user. companyId kommt ausschließlich von
  // hier (aus dem signierten Token) – nie aus Client-Eingaben.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      email: payload.email,
      permissions: payload.permissions,
    };
  }
}
