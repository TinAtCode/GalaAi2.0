import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, UpdateProjectStatusDto } from './dto/project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAllForCompany(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findAllForCompany(user.companyId);
  }

  @Get('by-property/:propertyId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAllForProperty(@CurrentUser() user: AuthenticatedUser, @Param('propertyId') propertyId: string) {
    return this.projectsService.findAllForProperty(user.companyId, propertyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.projectsService.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.companyId, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.projectsService.updateStatus(user.companyId, id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(user.companyId, id, dto);
  }
}
