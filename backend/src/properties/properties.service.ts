import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  // Objekte hängen nicht direkt an companyId, sondern an einem Kunden.
  // Deshalb muss die Zugehörigkeit IMMER über den Kunden geprüft werden –
  // sonst könnte jemand ein Objekt an eine fremde customerId hängen.
  private async assertCustomerBelongsToCompany(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
    });
    if (!customer) {
      throw new NotFoundException('Kunde nicht gefunden.');
    }
  }

  async findAllForCustomer(companyId: string, customerId: string) {
    await this.assertCustomerBelongsToCompany(companyId, customerId);
    return this.prisma.property.findMany({ where: { customerId } });
  }

  async findOne(companyId: string, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, customer: { companyId } },
      include: { projects: true },
    });
    if (!property) {
      throw new NotFoundException('Objekt nicht gefunden.');
    }
    return property;
  }

  async create(companyId: string, dto: CreatePropertyDto) {
    await this.assertCustomerBelongsToCompany(companyId, dto.customerId);
    return this.prisma.property.create({ data: dto });
  }
}
