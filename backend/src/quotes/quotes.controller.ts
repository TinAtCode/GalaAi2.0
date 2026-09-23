import { Body, Controller, Get, Param, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto, SetQuoteOutcomeDto } from './dto/quote.dto';

// Gleiches Prinzip wie bei Kalkulationen: Kosten (costPerUnit) brauchen
// price.purchase.read, Verkaufspreis (unitPrice/totalNet) braucht
// price.sale.read, Marge zusätzlich price.margin.read.
type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { lineItems: true } }>;

function maskQuote(quote: QuoteWithLines, permissions: string[]) {
  const canPurchase = permissions.includes(PERMISSIONS.PRICE_PURCHASE_READ);
  const canSale = permissions.includes(PERMISSIONS.PRICE_SALE_READ);
  const canMargin = permissions.includes(PERMISSIONS.PRICE_MARGIN_READ);

  return {
    id: quote.id,
    projectId: quote.projectId,
    number: quote.number,
    status: quote.status,
    createdAt: quote.createdAt,
    vatRate: quote.vatRate,
    vatTreatment: quote.vatTreatment,
    totalNet: canSale ? quote.totalNet : undefined,
    totalVat: canSale ? quote.totalVat : undefined,
    totalGross: canSale ? quote.totalGross : undefined,
    lineItems: quote.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      unit: li.unit,
      quantity: li.quantity,
      costPerUnit: canPurchase ? li.costPerUnit : undefined,
      unitPrice: canSale ? li.unitPrice : undefined,
      marginPerUnit: canMargin && canPurchase && canSale ? li.marginPerUnit : undefined,
      lineTotal: canSale ? li.lineTotal : undefined,
    })),
  };
}

@Controller('quotes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotesController {
  constructor(private quotesService: QuotesService) {}

  @Get('by-project/:projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findAllForProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    const quotes = await this.quotesService.findAllForProject(user.companyId, projectId);
    return quotes.map((q) => maskQuote(q, user.permissions));
  }

  // Das PDF enthält Verkaufspreise -> zusätzlich price.sale.read nötig.
  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ, PERMISSIONS.PRICE_SALE_READ)
  async pdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { buffer, fileName } = await this.quotesService.renderPdf(user.companyId, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${fileName}"`,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const quote = await this.quotesService.findOne(user.companyId, id);
    return maskQuote(quote, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuoteDto) {
    const quote = await this.quotesService.create(user.companyId, dto);
    return maskQuote(quote, user.permissions);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.QUOTE_APPROVE)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const quote = await this.quotesService.approve(user.companyId, user.userId, id);
    return maskQuote(quote, user.permissions);
  }

  @Post(':id/send')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  async send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const quote = await this.quotesService.send(user.companyId, user.userId, id);
    return maskQuote(quote, user.permissions);
  }

  @Post(':id/outcome')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  async setOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetQuoteOutcomeDto,
  ) {
    const quote = await this.quotesService.setOutcome(user.companyId, user.userId, id, dto.status);
    return maskQuote(quote, user.permissions);
  }
}
