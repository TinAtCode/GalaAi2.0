import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PERMISSIONS } from '../common/permissions';
import { RequirePermissions } from '../common/permissions.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import {
  ConfirmDeliveryNoteDto,
  CreateDeliveryNoteDto,
  DeliveryNoteQueryDto,
  SupplierMailQueryDto,
} from './delivery-notes.dto';
import { DeliveryNotesService } from './delivery-notes.service';

// Lieferscheine sehen und zuordnen: wer Dokumente sieht (Büro)
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DOCUMENT_READ)
export class DeliveryNotesController {
  constructor(private notes: DeliveryNotesService) {}

  @Get('delivery-notes')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: DeliveryNoteQueryDto) {
    return this.notes.list(user.companyId, query);
  }

  // vorhandenes Dokument als Lieferschein erkennen (auch erneut)
  @Post('delivery-notes')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeliveryNoteDto) {
    return this.notes.recognizeForDocument(user.companyId, dto.documentId);
  }

  @Put('delivery-notes/:id')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDeliveryNoteDto,
  ) {
    return this.notes.confirm(user, id, dto);
  }

  @Get('projects/:projectId/delivery-notes')
  forProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.notes.forProject(user.companyId, projectId);
  }

  // Mail-Entwurf an einen Lieferanten mit Projektnummer und Lieferadresse
  @Get('projects/:projectId/supplier-mail')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  supplierMail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: SupplierMailQueryDto,
  ) {
    return this.notes.supplierMail(user, projectId, query.supplierId);
  }
}
