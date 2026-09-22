import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CompanyService } from './company.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Controller('company/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanyController {
  constructor(private companyService: CompanyService) {}

  // Lesen ist jedem eingeloggten User erlaubt, da die Grundwerte (z.B.
  // Stundensatz) für die Kalkulationsanzeige gebraucht werden können.
  @Get()
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.companyService.getSettings(user.companyId);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCompanySettingsDto) {
    return this.companyService.updateSettings(user.companyId, dto);
  }
}
