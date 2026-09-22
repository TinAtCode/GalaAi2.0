import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArticleDto } from './dto/create-article.dto';

@Injectable()
export class ArticlesService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.article.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
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
}
