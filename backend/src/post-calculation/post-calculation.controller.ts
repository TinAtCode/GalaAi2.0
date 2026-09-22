import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { PostCalculationService } from './post-calculation.service';

@Controller('post-calculation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PostCalculationController {
  constructor(private postCalculationService: PostCalculationService) {}

  @Get(':projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  calculate(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.postCalculationService.calculateForProject(user.companyId, projectId);
  }
}
