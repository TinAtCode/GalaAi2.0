import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMachineDto } from './dto/create-machine.dto';

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
}
