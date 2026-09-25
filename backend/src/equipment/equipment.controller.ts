import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PERMISSIONS } from '../common/permissions';
import { RequirePermissions } from '../common/permissions.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import {
  CountItemDto,
  DueQueryDto,
  EquipmentDto,
  InventoryCountDto,
  MaintenanceDoneDto,
  MaintenanceDto,
  ReportDamageDto,
  UpdateDamageDto,
} from './equipment.dto';
import { EquipmentService } from './equipment.service';

// Geräte und Fahrzeuge: ansehen, Schäden melden und Inventur zählen darf jeder
// auf der Baustelle (site.use); anlegen, Schäden erledigen und Wartungen
// pflegen das Büro/die Werkstatt (masterdata.write).
@Controller('equipment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class EquipmentController {
  constructor(private equipment: EquipmentService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.equipment.list(user.companyId);
  }

  @Get('damages')
  openDamages(@CurrentUser() user: AuthenticatedUser) {
    return this.equipment.openDamages(user.companyId);
  }

  @Put('damages/:id')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  updateDamage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDamageDto,
  ) {
    return this.equipment.updateDamage(user, id, dto);
  }

  @Get('maintenance/due')
  due(@CurrentUser() user: AuthenticatedUser, @Query() query: DueQueryDto) {
    return this.equipment.due(user.companyId, query);
  }

  @Put('maintenance/:id')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  updateMaintenance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaintenanceDto,
  ) {
    return this.equipment.updateMaintenance(user, id, dto);
  }

  @Post('maintenance/:id/done')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  maintenanceDone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaintenanceDoneDto,
  ) {
    return this.equipment.maintenanceDone(user, id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.get(user.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: EquipmentDto) {
    return this.equipment.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EquipmentDto,
  ) {
    return this.equipment.update(user, id, dto);
  }

  @Post(':id/damages')
  reportDamage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDamageDto,
  ) {
    return this.equipment.reportDamage(user, id, dto);
  }

  @Post(':id/maintenance')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  addMaintenance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaintenanceDto,
  ) {
    return this.equipment.addMaintenance(user, id, dto);
  }
}

// Inventur: Durchgang starten/abschließen (Büro), Geräte zählen (Baustelle)
@Controller('inventory-counts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class InventoryController {
  constructor(private equipment: EquipmentService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.equipment.listCounts(user.companyId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: InventoryCountDto) {
    return this.equipment.createCount(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.getCount(user.companyId, id);
  }

  @Put(':id/items/:equipmentId')
  count(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: CountItemDto,
  ) {
    return this.equipment.countItem(user, id, equipmentId, dto);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  close(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.closeCount(user, id);
  }
}
