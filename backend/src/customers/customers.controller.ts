import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard) // 1. eingeloggt? 2. berechtigt?
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user.companyId, dto);
  }
}
