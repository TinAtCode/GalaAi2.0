import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { applyPriceVisibility } from '../common/price-visibility';
import { ServicesCatalogService } from './services-catalog.service';
import { AddServiceComponentDto, CreateServiceDto } from './dto/service.dto';

// Blendet Preisfelder in den verschachtelten Artikeln jeder Rezeptur aus,
// nach demselben Prinzip wie im Articles-Modul.
function maskServicePrices(service: any, permissions: string[]) {
  return {
    ...service,
    components: service.components?.map((c: any) => ({
      ...c,
      article: c.article ? applyPriceVisibility(c.article, permissions) : null,
    })),
  };
}

@Controller('services')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServicesCatalogController {
  constructor(private servicesService: ServicesCatalogService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    const services = await this.servicesService.findAll(user.companyId);
    return services.map((s: any) => maskServicePrices(s, user.permissions));
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const service = await this.servicesService.findOne(user.companyId, id);
    return maskServicePrices(service, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(user.companyId, dto);
  }

  @Post(':id/components')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  addComponent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddServiceComponentDto,
  ) {
    return this.servicesService.addComponent(user.companyId, id, dto);
  }
}
