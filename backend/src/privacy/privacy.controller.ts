import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { PrivacyService } from './privacy.service';

// Datenschutz: Auskunft (JSON) und Anonymisieren für Kunden und Nutzer
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrivacyController {
  constructor(private privacy: PrivacyService) {}

  // Auskunft nach Art. 15 DSGVO: alle Daten eines Kunden als JSON
  @Get('customers/:id/export')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ, PERMISSIONS.DATA_EXPORT)
  customerExport(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.customerExport(user.companyId, id);
  }

  // Anonymisieren auf Anfrage (Art. 17 DSGVO); nicht mit offenen Rechnungen oder laufendem Vertrag
  @Post('customers/:id/anonymize')
  @RequirePermissions(PERMISSIONS.CUSTOMER_DELETE)
  anonymizeCustomer(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.anonymizeCustomer(user.companyId, user.userId, id);
  }

  // Auskunft für Nutzer/Mitarbeiter: Profil, Rollen, Zeiten, Abwesenheiten, Termine, Nachrichten, Aktionen
  @Get('users/:id/export')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  userExport(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.userExport(user.companyId, id);
  }

  // Nutzer anonymisieren: gesperrt, Name und E-Mail entfernt; Zeiten bleiben (Aufbewahrung)
  @Post('users/:id/anonymize')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  anonymizeUser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.anonymizeUser(user.companyId, user.userId, id);
  }
}
