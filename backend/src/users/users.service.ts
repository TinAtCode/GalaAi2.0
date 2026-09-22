import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, normalizeEmail } from '../auth/passwords';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

// Nie passwordHash oder tokenVersion nach außen geben.
const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  active: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
  employee: { select: { id: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: PUBLIC_USER_FIELDS,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  private async findOneOrThrow(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId }, select: PUBLIC_USER_FIELDS });
    if (!user) {
      throw new NotFoundException('Benutzer nicht gefunden.');
    }
    return user;
  }

  async create(companyId: string, dto: CreateUserDto) {
    const roleIds = dto.roleIds ?? [];
    // Mandantenprüfung: nur Rollen der eigenen Firma zuweisen.
    const roleCount = await this.prisma.role.count({ where: { id: { in: roleIds }, companyId } });
    if (roleCount !== roleIds.length) {
      throw new NotFoundException('Mindestens eine Rolle wurde nicht gefunden.');
    }

    try {
      return await this.prisma.user.create({
        data: {
          companyId,
          email: normalizeEmail(dto.email),
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash: await hashPassword(dto.password),
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
          ...(dto.createEmployee
            ? { employee: { create: { companyId, firstName: dto.firstName, lastName: dto.lastName } } }
            : {}),
        },
        select: PUBLIC_USER_FIELDS,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Diese E-Mail-Adresse ist bereits vergeben.');
      }
      throw error;
    }
  }

  async update(companyId: string, actingUserId: string, id: string, dto: UpdateUserDto) {
    await this.findOneOrThrow(companyId, id);
    if (dto.active === false && id === actingUserId) {
      throw new BadRequestException('Du kannst dich nicht selbst deaktivieren.');
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        active: dto.active,
        // Deaktivieren meldet alle Sitzungen sofort ab.
        ...(dto.active === false ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    return this.findOneOrThrow(companyId, id);
  }

  // Passwort durch einen Admin neu setzen (z.B. vergessen). Meldet alle
  // Sitzungen des Nutzers ab.
  async resetPassword(companyId: string, id: string, password: string) {
    await this.findOneOrThrow(companyId, id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
    });
    return { reset: true };
  }
}
