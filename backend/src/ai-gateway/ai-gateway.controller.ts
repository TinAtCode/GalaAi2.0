import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { AiGatewayService } from './ai-gateway.service';
import { CompleteDto } from './dto/complete.dto';

// "ai.use" (Punkt 8): jede Nutzung der KI ist eine geschützte Aktion.
@Controller('ai/gateway')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiGatewayController {
  constructor(private aiGatewayService: AiGatewayService) {}

  @Get('status')
  status() {
    return { activeProvider: this.aiGatewayService.getActiveProviderName() };
  }

  @Post('complete')
  @RequirePermissions(PERMISSIONS.AI_USE)
  complete(@CurrentUser() user: AuthenticatedUser, @Body() dto: CompleteDto) {
    return this.aiGatewayService.complete(user.companyId, user.userId, dto);
  }
}
