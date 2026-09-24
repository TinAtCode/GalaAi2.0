import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

// Auftragssumme ist ein Verkaufspreis: ohne price.sale.read nicht ausliefern
function maskOrder<T extends { totalNet: unknown }>(order: T, permissions: string[]) {
  if (permissions.includes(PERMISSIONS.PRICE_SALE_READ)) return order;
  const { totalNet, ...rest } = order;
  void totalNet;
  return rest;
}

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get('by-project/:projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findAllForProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    const orders = await this.ordersService.findAllForProject(user.companyId, projectId);
    return orders.map((o) => maskOrder(o, user.permissions));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return maskOrder(await this.ordersService.findOne(user.companyId, id), user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.createFromQuote(user.companyId, dto.quoteId);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user.companyId, user.userId, id, dto);
  }
}
