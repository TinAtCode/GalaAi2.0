import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { AiGatewayService } from './ai-gateway.service';
import { CompleteDto } from './dto/complete.dto';
import { CreateAiProviderDto, UpdateAiProviderDto } from './dto/provider.dto';

// Nutzen braucht "ai.use"; Anbieter einrichten die Systemeinstellungen.
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiGatewayController {
  constructor(private ai: AiGatewayService) {}

  @Get('gateway/status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.status(user.companyId);
  }

  @Post('gateway/complete')
  @RequirePermissions(PERMISSIONS.AI_USE)
  complete(@CurrentUser() user: AuthenticatedUser, @Body() dto: CompleteDto) {
    return this.ai.complete(user, dto);
  }

  @Get('providers')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.list(user.companyId);
  }

  @Post('providers')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAiProviderDto) {
    return this.ai.create(user, dto);
  }

  @Patch('providers/:id')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiProviderDto,
  ) {
    return this.ai.update(user, id, dto);
  }

  @Delete('providers/:id')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.remove(user, id);
  }

  @Post('providers/:id/test')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE, PERMISSIONS.AI_USE)
  test(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.test(user, id);
  }
}
