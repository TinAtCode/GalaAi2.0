import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { maskCalculationResult } from '../common/price-visibility';
import { CalculationsService } from './calculations.service';
import { CalculateServiceDto } from './dto/calculate-service.dto';

@Controller('calculations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CalculationsController {
  constructor(private calculationsService: CalculationsService) {}

  // Keine zusätzliche @RequirePermissions hier: JEDER eingeloggte User darf
  // eine Kalkulation anstoßen, aber WELCHE Felder er im Ergebnis sieht,
  // hängt von seinen Preisrechten ab (maskCalculationResult).
  @Post()
  async calculate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CalculateServiceDto) {
    const result = await this.calculationsService.calculateForService(user.companyId, dto);
    return maskCalculationResult(result, user.permissions);
  }
}
