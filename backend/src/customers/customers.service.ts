import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';

// MUSTER FÜR ALLE WEITEREN MODULE:
// Jede Methode nimmt companyId als Parameter entgegen (kommt vom Controller
// aus dem JWT, nie vom Client-Body) und filtert JEDE Query danach. Das ist
// die eigentliche Umsetzung der Mandantentrennung aus dem Architekturdokument
// – nicht als globaler Middleware-"Trick", sondern explizit und damit
// nachvollziehbar in jeder Query sichtbar.
@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      include: { properties: true },
    });
    if (!customer) {
      throw new NotFoundException('Kunde nicht gefunden.');
    }
    return customer;
  }

  create(companyId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: { ...dto, companyId },
    });
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }
}
