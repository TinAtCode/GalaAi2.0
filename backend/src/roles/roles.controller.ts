import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { RolesService } from './roles.service';
import { AssignRoleDto, CreateRoleDto, UpdateRolePermissionsDto } from './dto/role.dto';

// Rollenverwaltung ist Teil der Administration -> system.settings.write.
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.findAll(user.companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(user.companyId, dto);
  }

  @Patch(':id/permissions')
  setPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(user.companyId, id, dto.permissionKeys);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.rolesService.assignToUser(user.companyId, id, dto.userId);
  }

  @Delete(':id/assign/:userId')
  unassign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.rolesService.removeFromUser(user.companyId, id, userId);
  }
}
