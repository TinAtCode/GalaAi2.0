import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';
import { Response } from 'express';
import { SearchQueryDto, withTotalCount } from '../common/pagination';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard) // 1. eingeloggt? 2. berechtigt?
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: SearchQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.customersService.findAll(user.companyId, page));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.findOne(user.companyId, id);
  }

  // Angebote, Rechnungen und Umsatz je Jahr (Beträge je nach Rechten)
  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  history(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.history(user.companyId, id, {
      salePrices: user.permissions.includes(PERMISSIONS.PRICE_SALE_READ),
      invoices: user.permissions.includes(PERMISSIONS.INVOICE_CREATE),
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user.companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(user.companyId, id, dto);
  }
}
