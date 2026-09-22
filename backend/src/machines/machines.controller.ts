import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { MachinesService } from './machines.service';
import { CreateMachineDto } from './dto/create-machine.dto';

// Der Stundensatz einer Maschine ist ein interner Kostenfaktor (wie ein
// Einkaufspreis) – daher dieselbe Filterung wie bei Artikeln, nur ohne
// separaten Verkaufspreis.
function maskMachine(machine: any, permissions: string[]) {
  const canSeeCost = permissions.includes(PERMISSIONS.PRICE_PURCHASE_READ);
  return { ...machine, hourlyRate: canSeeCost ? machine.hourlyRate : undefined };
}

@Controller('machines')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MachinesController {
  constructor(private machinesService: MachinesService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    const machines = await this.machinesService.findAll(user.companyId);
    return machines.map((m: any) => maskMachine(m, user.permissions));
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const machine = await this.machinesService.findOne(user.companyId, id);
    return maskMachine(machine, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMachineDto) {
    const machine = await this.machinesService.create(user.companyId, dto);
    return maskMachine(machine, user.permissions);
  }
}
