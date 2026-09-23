import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageArgs } from '../common/pagination';
import { AuditLogQueryDto } from './audit-log.dto';

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  // Neueste zuerst, mit dem Namen der handelnden Person (sofern es sie gibt:
  // Einträge aus Importen oder vom System haben keinen Nutzer).
  async findAll(companyId: string, query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      companyId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.auditLog.count({ where }),
    ]);

    const userIds = [...new Set(entries.map((e) => e.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { companyId, id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    const items = entries.map(({ companyId: _companyId, userId, ...entry }) => ({
      ...entry,
      user: userId ? { id: userId, name: names.get(userId) ?? 'Unbekannt' } : null,
    }));
    return { items, total };
  }
}
