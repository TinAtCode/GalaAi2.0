import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { requiredFile } from '../common/required-file';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';
import { PlansService } from './plans.service';

const upload = FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } });

// Lagepläne: ansehen mit plan.read (auch Mitarbeiter), zeichnen mit plan.write
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlansController {
  constructor(private plans: PlansService) {}

  @Get('projects/:projectId/plans')
  @RequirePermissions(PERMISSIONS.PLAN_READ)
  list(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.plans.list(user.companyId, projectId);
  }

  @Post('projects/:projectId/plans')
  @RequirePermissions(PERMISSIONS.PLAN_WRITE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePlanDto,
  ) {
    return this.plans.create(user.companyId, projectId, dto);
  }

  @Get('plans/:id')
  @RequirePermissions(PERMISSIONS.PLAN_READ)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plans.get(user.companyId, id);
  }

  @Put('plans/:id')
  @RequirePermissions(PERMISSIONS.PLAN_WRITE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(user.companyId, id, dto);
  }

  @Delete('plans/:id')
  @RequirePermissions(PERMISSIONS.PLAN_WRITE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plans.remove(user.companyId, id);
  }

  @Post('plans/:id/background')
  @RequirePermissions(PERMISSIONS.PLAN_WRITE)
  @UseInterceptors(upload)
  setBackground(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(requiredFile()) file: Express.Multer.File,
  ) {
    return this.plans.setBackground(user.companyId, user.userId, id, file);
  }

  @Delete('plans/:id/background')
  @RequirePermissions(PERMISSIONS.PLAN_WRITE)
  removeBackground(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plans.removeBackground(user.companyId, id);
  }

  @Get('plans/:id/background')
  @RequirePermissions(PERMISSIONS.PLAN_READ)
  async background(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { content, contentType } = await this.plans.background(user.companyId, id);
    return new StreamableFile(content, { type: contentType });
  }
}
