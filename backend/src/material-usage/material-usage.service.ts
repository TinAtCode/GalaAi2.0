import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordMaterialUsageDto } from './dto/record-material-usage.dto';

@Injectable()
export class MaterialUsageService {
  constructor(private prisma: PrismaService) {}

  async findAllForProject(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    return this.prisma.projectMaterialUsage.findMany({
      where: { projectId, companyId },
      include: {
        article: { select: { id: true, name: true, unit: true, articleNumber: true, purchasePrice: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(companyId: string, userId: string, dto: RecordMaterialUsageDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }

    const article = await this.prisma.article.findFirst({
      where: { id: dto.articleId, companyId },
    });
    if (!article) {
      throw new NotFoundException('Artikel nicht gefunden.');
    }

    return this.prisma.projectMaterialUsage.create({
      data: {
        companyId,
        projectId: dto.projectId,
        articleId: dto.articleId,
        quantity: dto.quantity,
        recordedByUserId: userId,
      },
    });
  }
}
