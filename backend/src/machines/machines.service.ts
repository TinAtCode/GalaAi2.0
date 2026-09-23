import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMachineDto, UpdateMachineDto } from './dto/create-machine.dto';
import { changedFields, writeAudit } from '../common/audit';

@Injectable()
export class MachinesService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.machine.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  async findOne(companyId: string, id: string) {
    const machine = await this.prisma.machine.findFirst({ where: { id, companyId } });
    if (!machine) {
      throw new NotFoundException('Maschine nicht gefunden.');
    }
    return machine;
  }

  create(companyId: string, dto: CreateMachineDto) {
    return this.prisma.machine.create({ data: { ...dto, companyId } });
  }

  // Änderung und Audit-Eintrag in einer Transaktion: Preisänderungen sind
  // immer nachvollziehbar (wer, wann, von welchem auf welchen Wert).
  async update(companyId: string, userId: string, id: string, dto: UpdateMachineDto) {
    const before = await this.findOne(companyId, id);
    const { oldData, newData, hasChanges } = changedFields(before, { ...dto });
    if (!hasChanges) return before;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.machine.update({ where: { id }, data: dto });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'machine_update',
        entity: 'Machine',
        entityId: id,
        oldData,
        newData,
      });
      return updated;
    });
  }
}
