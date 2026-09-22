import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto, UpdateProjectStatusDto } from './dto/project.dto';
import { pageArgs, PageQueryDto } from '../common/pagination';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  // Ein Projekt trägt seine companyId selbst. Beim Anlegen wird geprüft, dass
  // das Objekt zur selben Firma gehört – so kann niemand über eine fremde
  // propertyId Daten einer anderen Firma anlegen.
  private async assertPropertyBelongsToCompany(companyId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId },
    });
    if (!property) {
      throw new NotFoundException('Objekt nicht gefunden.');
    }
  }

  // Übersicht über ALLE Projekte der Firma (nicht nur je Objekt) – für eine
  // zentrale Projekt-Liste im Frontend, mit Kunde/Objekt direkt mitgeladen,
  // damit das Frontend nicht pro Zeile nachladen muss.
  async findAllForCompany(companyId: string, page: PageQueryDto = {}) {
    const where = { companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: { property: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(page),
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total };
  }

  async findAllForProperty(companyId: string, propertyId: string) {
    await this.assertPropertyBelongsToCompany(companyId, propertyId);
    return this.prisma.project.findMany({
      where: { propertyId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    return project;
  }

  async create(companyId: string, dto: CreateProjectDto) {
    await this.assertPropertyBelongsToCompany(companyId, dto.propertyId);
    return this.prisma.project.create({
      data: { companyId, propertyId: dto.propertyId, title: dto.title },
    });
  }

  async updateStatus(companyId: string, id: string, dto: UpdateProjectStatusDto) {
    // findOne wirft bereits NotFoundException, wenn das Projekt nicht zur
    // Company gehört -> updateMany direkt danach ist sicher.
    await this.findOne(companyId, id);
    return this.prisma.project.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async update(companyId: string, id: string, dto: UpdateProjectDto) {
    await this.findOne(companyId, id);
    return this.prisma.project.update({ where: { id }, data: { title: dto.title } });
  }
}
