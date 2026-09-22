import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectStatusDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  // Ein Projekt hängt an einem Objekt, das Objekt an einem Kunden, der Kunde
  // an der Company. Die Kette wird bei jedem Zugriff komplett über die
  // Prisma-Relation geprüft (property.customer.companyId) – so kann niemand
  // über eine fremde propertyId Daten einer anderen Firma anlegen oder lesen.
  private async assertPropertyBelongsToCompany(companyId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, customer: { companyId } },
    });
    if (!property) {
      throw new NotFoundException('Objekt nicht gefunden.');
    }
  }

  // Übersicht über ALLE Projekte der Firma (nicht nur je Objekt) – für eine
  // zentrale Projekt-Liste im Frontend, mit Kunde/Objekt direkt mitgeladen,
  // damit das Frontend nicht pro Zeile nachladen muss.
  findAllForCompany(companyId: string) {
    return this.prisma.project.findMany({
      where: { property: { customer: { companyId } } },
      include: { property: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllForProperty(companyId: string, propertyId: string) {
    await this.assertPropertyBelongsToCompany(companyId, propertyId);
    return this.prisma.project.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, property: { customer: { companyId } } },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    return project;
  }

  async create(companyId: string, dto: CreateProjectDto) {
    await this.assertPropertyBelongsToCompany(companyId, dto.propertyId);
    return this.prisma.project.create({
      data: { propertyId: dto.propertyId, title: dto.title },
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
}
