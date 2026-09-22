import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  // Mitarbeiterliste/-daten sind laut Punkt 8 im Ursprungsdokument
  // ausdrücklich geschützt (employee.data.read).
  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.employeesService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employeesService.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(user.companyId, dto);
  }
}
