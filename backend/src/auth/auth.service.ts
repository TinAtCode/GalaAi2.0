import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { loadUserWithPermissions } from './permissions-of-user';
import { hashPassword, normalizeEmail } from './passwords';

const publicUser = (
  user: { id: string; email: string; firstName: string; lastName: string },
  permissions: string[],
) => ({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, permissions });

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const found = await loadUserWithPermissions(this.prisma, { email: normalizeEmail(email) });

    if (!found || !found.user.active) {
      throw new UnauthorizedException('E-Mail oder Passwort ist falsch.');
    }
    const { user, permissions } = found;

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('E-Mail oder Passwort ist falsch.');
    }

    // Das Token trägt nur noch die Identität und die tokenVersion. Rechte und
    // "aktiv" prüft die JwtStrategy bei jeder Anfrage live – Rollenänderungen
    // und Deaktivierungen wirken damit sofort, nicht erst nach Ablauf des Tokens.
    const payload = { sub: user.id, companyId: user.companyId, email: user.email, tv: user.tokenVersion };

    return { accessToken: this.jwtService.sign(payload), user: publicUser(user, permissions) };
  }

  async me(userId: string) {
    const found = await loadUserWithPermissions(this.prisma, { id: userId });
    if (!found) {
      throw new UnauthorizedException('Sitzung ist nicht mehr gültig.');
    }
    return publicUser(found.user, found.permissions);
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Das aktuelle Passwort ist falsch.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    });
    // Neues Token ausstellen, damit dieses Gerät angemeldet bleibt – alle
    // anderen Sitzungen sind durch die neue tokenVersion abgemeldet.
    return this.login(user.email, newPassword);
  }
}
