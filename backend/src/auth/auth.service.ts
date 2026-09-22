import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('E-Mail oder Passwort ist falsch.');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('E-Mail oder Passwort ist falsch.');
    }

    // Permissions aus allen Rollen des Users einsammeln (dedupliziert).
    // HINWEIS (dokumentiert in STATUS.md): Permissions werden beim Login in
    // das JWT eingebettet. Ändert sich eine Rolle während einer aktiven
    // Session, wirkt das erst nach erneutem Login. Für Version 1 akzeptiert;
    // spätere Version kann Permissions stattdessen bei jedem Request live
    // aus der DB lesen (Trade-off: Performance vs. Aktualität).
    const permissionSet = new Set<string>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissionSet.add(rolePermission.permission.key);
      }
    }

    const payload = {
      sub: user.id,
      companyId: user.companyId,
      email: user.email,
      permissions: Array.from(permissionSet),
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        permissions: payload.permissions,
      },
    };
  }
}
