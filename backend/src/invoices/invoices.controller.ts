import { Body, Controller, Delete, Get, Param, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { InvoicesService } from './invoices.service';
import { CancelInvoiceDto, CreateInvoiceFromOrderDto, IssueInvoiceDto } from './dto/invoice.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INVOICE_CREATE)
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get('by-project/:projectId')
  findAllForProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.invoicesService.findAllForProject(user.companyId, projectId);
  }

  @Get(':id/pdf')
  async pdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { buffer, fileName } = await this.invoicesService.renderPdf(user.companyId, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${fileName}"`,
    });
  }

  @Get(':id/xrechnung')
  async xrechnung(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { buffer, fileName } = await this.invoicesService.renderXRechnung(user.companyId, id);
    return new StreamableFile(buffer, {
      type: 'application/xml',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicesService.findOne(user.companyId, id);
  }

  @Post('from-order')
  createFromOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceFromOrderDto) {
    return this.invoicesService.createFromOrder(user.companyId, dto);
  }

  @Delete(':id')
  removeDraft(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicesService.removeDraft(user.companyId, id);
  }

  @Post(':id/issue')
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: IssueInvoiceDto) {
    return this.invoicesService.issue(user.companyId, user.userId, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoicesService.cancel(user.companyId, user.userId, id, dto.reason);
  }
}
