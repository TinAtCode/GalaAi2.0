import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddServiceComponentDto, CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

@Injectable()
export class ServicesCatalogService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId },
      include: { components: { include: { article: true, machine: true } } },
      orderBy: { name: 'asc' },
    });
  }

  private async assertBelongsToCompany(companyId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, companyId } });
    if (!service) {
      throw new NotFoundException('Dienstleistung nicht gefunden.');
    }
    return service;
  }

  async findOne(companyId: string, id: string) {
    await this.assertBelongsToCompany(companyId, id);
    return this.prisma.service.findUnique({
      where: { id },
      include: { components: { include: { article: true, machine: true } } },
    });
  }

  create(companyId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({ data: { ...dto, companyId } });
  }

  async addComponent(companyId: string, serviceId: string, dto: AddServiceComponentDto) {
    await this.assertBelongsToCompany(companyId, serviceId);

    if (!dto.articleId && dto.laborMinutes == null && !dto.machineId) {
      throw new BadRequestException(
        'Ein Bestandteil braucht einen Artikel (mit quantityPer), laborMinutes oder eine Maschine (mit machineMinutes).',
      );
    }

    if (dto.machineId) {
      // Mandantenprüfung: die Maschine muss zur selben Firma gehören.
      const machine = await this.prisma.machine.findFirst({ where: { id: dto.machineId, companyId } });
      if (!machine) {
        throw new NotFoundException('Maschine nicht gefunden.');
      }
    }

    if (dto.articleId) {
      // Mandantenprüfung: der Artikel muss zur selben Firma gehören.
      const article = await this.prisma.article.findFirst({
        where: { id: dto.articleId, companyId },
      });
      if (!article) {
        throw new NotFoundException('Artikel nicht gefunden.');
      }
    }

    return this.prisma.serviceComponent.create({
      data: {
        serviceId,
        articleId: dto.articleId,
        quantityPer: dto.quantityPer ?? 0,
        laborMinutes: dto.laborMinutes,
        machineId: dto.machineId,
        machineMinutes: dto.machineId ? dto.machineMinutes : null,
      },
    });
  }

  async update(companyId: string, id: string, dto: UpdateServiceDto) {
    await this.assertBelongsToCompany(companyId, id);
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  // Rezeptur korrigieren: einen Bestandteil entfernen. Bestehende Angebote
  // sind davon nicht betroffen (Preis-Snapshot, siehe QuotesService).
  async removeComponent(companyId: string, serviceId: string, componentId: string) {
    await this.assertBelongsToCompany(companyId, serviceId);
    const { count } = await this.prisma.serviceComponent.deleteMany({
      where: { id: componentId, serviceId },
    });
    if (count === 0) {
      throw new NotFoundException('Bestandteil nicht gefunden.');
    }
    return { removed: true };
  }
}
