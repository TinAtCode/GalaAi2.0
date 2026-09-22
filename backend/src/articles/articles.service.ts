import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArticleDto, UpdateArticleDto } from './dto/create-article.dto';
import { changedFields, writeAudit } from '../common/audit';
import { pageArgs, PageQueryDto } from '../common/pagination';

@Injectable()
export class ArticlesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, page: PageQueryDto = {}) {
    const where = { companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(page) }),
      this.prisma.article.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(companyId: string, id: string) {
    const article = await this.prisma.article.findFirst({ where: { id, companyId } });
    if (!article) {
      throw new NotFoundException('Artikel nicht gefunden.');
    }
    return article;
  }

  create(companyId: string, dto: CreateArticleDto) {
    return this.prisma.article.create({ data: { ...dto, companyId } });
  }

  // Änderung und Audit-Eintrag in einer Transaktion: Preisänderungen sind
  // immer nachvollziehbar (wer, wann, von welchem auf welchen Wert).
  async update(companyId: string, userId: string, id: string, dto: UpdateArticleDto) {
    const before = await this.findOne(companyId, id);
    const { oldData, newData, hasChanges } = changedFields(before, { ...dto });
    if (!hasChanges) return before;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.article.update({ where: { id }, data: dto });
        await writeAudit(tx, {
          companyId,
          userId,
          action: 'article_update',
          entity: 'Article',
          entityId: id,
          oldData,
          newData,
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Diese Artikelnummer ist bereits vergeben.');
      }
      throw error;
    }
  }
}
