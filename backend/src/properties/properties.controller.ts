import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/create-property.dto';

@Controller('properties')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PropertiesController {
  constructor(private propertiesService: PropertiesService) {}

  @Get('by-customer/:customerId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAllForCustomer(@CurrentUser() user: AuthenticatedUser, @Param('customerId') customerId: string) {
    return this.propertiesService.findAllForCustomer(user.companyId, customerId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.propertiesService.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user.companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePropertyDto) {
    return this.propertiesService.update(user.companyId, id, dto);
  }
}
