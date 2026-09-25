import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { PostCalculationService } from './post-calculation.service';

@Controller('post-calculation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PostCalculationController {
  constructor(private postCalculationService: PostCalculationService) {}

  @Get(':projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async calculate(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    const result = await this.postCalculationService.calculateForProject(user.companyId, projectId);
    // Materialkosten beruhen auf Einkaufspreisen: nur mit price.purchase.read
    if (user.permissions.includes(PERMISSIONS.PRICE_PURCHASE_READ))
      return user.permissions.includes(PERMISSIONS.INVOICE_CREATE) ? result : { ...result, margin: null };
    // Deckungsbeitrag nur mit Einkaufspreisen und Rechnungsrecht (Umsatz)
    return { ...result, material: null, purchases: null, margin: null };
  }
}
