import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddServiceComponentDto, CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

@Injectable()
export class ServicesCatalogService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.service.findMany({
      where: { companyId },
      include: { components: { include: { article: true } } },
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
      include: { components: { include: { article: true } } },
    });
  }

  create(companyId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({ data: { ...dto, companyId } });
  }

  async addComponent(companyId: string, serviceId: string, dto: AddServiceComponentDto) {
    await this.assertBelongsToCompany(companyId, serviceId);

    if (!dto.articleId && dto.laborMinutes == null) {
      throw new BadRequestException(
        'Ein Bestandteil braucht entweder einen Artikel (mit quantityPer) oder laborMinutes.',
      );
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
