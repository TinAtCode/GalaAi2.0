import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { ContractsService } from './contracts.service';
import { CreateContractDto, ScheduleDto, UpdateContractDto } from './contract.dto';

type Presented = Awaited<ReturnType<ContractsService['findOne']>>;

// Vergütung ist ein Verkaufspreis: ohne price.sale.read keine Preise
function maskContract(contract: Presented, permissions: string[]) {
  if (permissions.includes(PERMISSIONS.PRICE_SALE_READ)) return contract;
  const { netPerPeriod, lines, ...rest } = contract;
  void netPerPeriod;
  return { ...rest, lines: lines.map(({ unitPrice, ...line }) => (void unitPrice, line)) };
}

// Pflege- und Wartungsverträge: ansehen wie Projekte (customer.read),
// anlegen und planen wie Termine (customer.write, mit Preisen nur mit
// price.sale.read), abrechnen mit invoice.create
@Controller('contracts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContractsController {
  constructor(private contracts: ContractsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query('projectId') projectId?: string) {
    const list = await this.contracts.findAll(user.companyId, projectId);
    return list.map((c) => maskContract(c, user.permissions));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return maskContract(await this.contracts.findOne(user.companyId, id), user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE, PERMISSIONS.PRICE_SALE_READ)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContractDto) {
    return this.contracts.create(user.companyId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE, PERMISSIONS.PRICE_SALE_READ)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.remove(user.companyId, user.userId, id);
  }

  // Fällige Einsätze als Termine planen (alle aktiven Verträge oder einer)
  @Post('schedule')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  schedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScheduleDto) {
    return this.contracts.schedule(user.companyId, dto);
  }

  // Alle fälligen Zeiträume als Rechnungsentwürfe
  @Post('invoice-due')
  @RequirePermissions(PERMISSIONS.INVOICE_CREATE)
  invoiceDue(@CurrentUser() user: AuthenticatedUser) {
    return this.contracts.invoiceDue(user.companyId);
  }

  // Nächsten Zeitraum eines Vertrags abrechnen (auch vor der Fälligkeit)
  @Post(':id/invoice')
  @RequirePermissions(PERMISSIONS.INVOICE_CREATE)
  createInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.createInvoice(user.companyId, id);
  }
}
