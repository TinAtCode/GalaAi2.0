import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PERMISSIONS } from '../common/permissions';
import { RequirePermissions } from '../common/permissions.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import { DiaryEntryDto, DiaryQueryDto } from './site-diary.dto';
import { SiteDiaryService } from './site-diary.service';

// Bautagebuch: wer auf der Baustelle arbeitet (site.use) – Mitarbeiter, Büro, Chef
@Controller('projects/:projectId/diary')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class SiteDiaryController {
  constructor(private diary: SiteDiaryService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: DiaryQueryDto,
  ) {
    return this.diary.list(user.companyId, projectId, query);
  }

  @Put(':day')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('day') day: string,
    @Body() dto: DiaryEntryDto,
  ) {
    return this.diary.save(user, projectId, day, dto);
  }
}
