import { ExecutionContext } from '@nestjs/common';
import { ThrottlerOptions } from '@nestjs/throttler';

// Zwei Grenzen für den Login:
//  1. pro Konto (E-Mail) und IP – bremst das Durchprobieren von Passwörtern
//     für ein Konto, ohne dass sich Kollegen im selben Büro-WLAN oder hinter
//     demselben Proxy gegenseitig aussperren (früher zählte nur die IP).
//  2. pro IP, großzügiger – bremst das Durchprobieren vieler Konten von einer
//     Adresse aus (siehe @Throttle am AuthController).
// Die Werte nur für automatisierte Tests erhöhen.
export const loginAccountLimit = () => Number(process.env.LOGIN_RATE_LIMIT) || 5;
export const loginIpLimit = () => Number(process.env.LOGIN_IP_RATE_LIMIT) || 30;

const isLoginRequest = (context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest();
  return req.method === 'POST' && req.route?.path === '/auth/login';
};

export const LOGIN_ACCOUNT_THROTTLER: ThrottlerOptions = {
  name: 'login-account',
  ttl: 60000,
  limit: loginAccountLimit,
  skipIf: (context) => !isLoginRequest(context),
  getTracker: (req) =>
    `${req.ip}|${String(req.body?.email ?? '')
      .trim()
      .toLowerCase()}`,
};
