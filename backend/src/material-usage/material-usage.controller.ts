import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { MaterialUsageService } from './material-usage.service';
import { RecordMaterialUsageDto } from './dto/record-material-usage.dto';

@Controller('material-usage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MaterialUsageController {
  constructor(private materialUsageService: MaterialUsageService) {}

  @Get('by-project/:projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAllForProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.materialUsageService.findAllForProject(user.companyId, projectId);
  }

  // Gleiche Permission wie Termine/Baustellendokumentation (customer.write) –
  // siehe Entscheidungstabelle in STATUS.md.
  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordMaterialUsageDto) {
    return this.materialUsageService.record(user.companyId, user.userId, dto);
  }
}
