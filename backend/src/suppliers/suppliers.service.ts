import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/create-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.supplier.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  async findOne(companyId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) {
      throw new NotFoundException('Lieferant nicht gefunden.');
    }
    return supplier;
  }

  create(companyId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: { ...dto, companyId } });
  }

  async update(companyId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(companyId, id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }
}
