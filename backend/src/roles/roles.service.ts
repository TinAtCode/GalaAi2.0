import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { writeAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.role.findMany({
      where: { companyId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // Löst Permission-Keys (z.B. "price.sale.read") in ihre DB-IDs auf.
  // Unbekannte Keys führen zu einem klaren Fehler statt stillem Ignorieren –
  // sonst könnte ein Tippfehler im Frontend dazu führen, dass eine Rolle
  // unbemerkt weniger Rechte bekommt als gedacht.
  private async resolvePermissionIds(keys: string[]) {
    if (keys.length === 0) return [];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const foundKeys = new Set(permissions.map((p: any) => p.key));
    const unknown = keys.filter((k) => !foundKeys.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unbekannte Permission-Keys: ${unknown.join(', ')}`);
    }
    return permissions.map((p: any) => p.id);
  }

  async create(companyId: string, dto: CreateRoleDto) {
    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys ?? []);
    return this.prisma.role.create({
      data: {
        companyId,
        name: dto.name,
        permissions: { create: permissionIds.map((permissionId: string) => ({ permissionId })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  private async assertRoleBelongsToCompany(companyId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId } });
    if (!role) {
      throw new NotFoundException('Rolle nicht gefunden.');
    }
    return role;
  }

  async setPermissions(companyId: string, userId: string, roleId: string, keys: string[]) {
    await this.assertRoleBelongsToCompany(companyId, roleId);
    const permissionIds = await this.resolvePermissionIds(keys);

    // Ersetzen statt Merge: die übergebene Liste ist die neue vollständige
    // Rechtemenge der Rolle (einfacher für das Frontend – z.B. eine
    // Checkbox-Liste, die komplett zurückgeschickt wird).
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId: string) => ({ roleId, permissionId })),
      });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'role_permissions',
        entity: 'Role',
        entityId: roleId,
        oldData: { permissions: before.map((rp) => rp.permission.key).sort() },
        newData: { permissions: [...new Set(keys)].sort() },
      });
    });

    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async assignToUser(companyId: string, actingUserId: string, roleId: string, userId: string) {
    const role = await this.assertRoleBelongsToCompany(companyId, roleId);

    // Mandantenprüfung: der Ziel-User muss zur selben Firma gehören wie die
    // Rolle – sonst könnte man einen User einer anderen Firma "hijacken".
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) {
      throw new NotFoundException('Benutzer nicht gefunden.');
    }

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userRole.upsert({
        where: { userId_roleId: { userId, roleId } },
        update: {},
        create: { userId, roleId },
      });
      await writeAudit(tx, {
        companyId,
        userId: actingUserId,
        action: 'user_role_assign',
        entity: 'User',
        entityId: userId,
        newData: { roleId, role: role.name },
      });
      return assignment;
    });
  }

  async removeFromUser(companyId: string, actingUserId: string, roleId: string, userId: string) {
    const role = await this.assertRoleBelongsToCompany(companyId, roleId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userRole.deleteMany({ where: { userId, roleId } });
      if (count > 0) {
        await writeAudit(tx, {
          companyId,
          userId: actingUserId,
          action: 'user_role_remove',
          entity: 'User',
          entityId: userId,
          oldData: { roleId, role: role.name },
        });
      }
    });
    return { removed: true };
  }
}
