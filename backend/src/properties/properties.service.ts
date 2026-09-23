import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/create-property.dto';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  // Beim Anlegen muss der Kunde zur Firma gehören – sonst könnte jemand ein
  // Objekt an eine fremde customerId hängen. Danach trägt das Objekt seine
  // companyId selbst, Lesezugriffe filtern direkt darüber.
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
    return this.prisma.property.findMany({ where: { customerId, companyId } });
  }

  async findOne(companyId: string, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, companyId },
      include: { projects: true },
    });
    if (!property) {
      throw new NotFoundException('Objekt nicht gefunden.');
    }
    return property;
  }

  async create(companyId: string, dto: CreatePropertyDto) {
    await this.assertCustomerBelongsToCompany(companyId, dto.customerId);
    return this.prisma.property.create({ data: { ...dto, companyId } });
  }

  async update(companyId: string, id: string, dto: UpdatePropertyDto) {
    await this.findOne(companyId, id);
    return this.prisma.property.update({ where: { id }, data: dto });
  }
}
