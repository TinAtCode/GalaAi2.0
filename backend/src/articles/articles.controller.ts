import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { applyPriceVisibility } from '../common/price-visibility';
import { ArticlesService } from './articles.service';
import { CreateArticleDto, UpdateArticleDto } from './dto/create-article.dto';
import { Response } from 'express';
import { PageQueryDto, withTotalCount } from '../common/pagination';

@Controller('articles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ArticlesController {
  constructor(private articlesService: ArticlesService) {}

  // Lesen ist grundsätzlich jedem eingeloggten User erlaubt (Name/Einheit
  // werden z.B. für die Kalkulation benötigt) – die Preisfelder selbst
  // werden aber pro User anhand seiner Rechte aus- oder eingeblendet.
  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.articlesService.findAll(user.companyId, page);
    return withTotalCount(res, { items: items.map((a) => applyPriceVisibility(a, user.permissions)), total });
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const article = await this.articlesService.findOne(user.companyId, id);
    return applyPriceVisibility(article, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleDto) {
    const article = await this.articlesService.create(user.companyId, dto);
    return applyPriceVisibility(article, user.permissions);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    const article = await this.articlesService.update(user.companyId, user.userId, id, dto);
    return applyPriceVisibility(article, user.permissions);
  }
}
