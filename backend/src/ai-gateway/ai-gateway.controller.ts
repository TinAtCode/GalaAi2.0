import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { AiGatewayService } from './ai-gateway.service';
import { CompleteDto } from './dto/complete.dto';
import { AssignTaskDto, CreateAiProviderDto, UpdateAiProviderDto } from './dto/provider.dto';
import { PhotoDescriptionDto, QuoteTextDto, SiteSummaryDto } from './dto/assist.dto';
import { AiAssistService } from './ai-assist.service';

// Nutzen braucht "ai.use"; Anbieter einrichten die Systemeinstellungen.
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiGatewayController {
  constructor(
    private ai: AiGatewayService,
    private assist: AiAssistService,
  ) {}

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

  // welche Aufgabe welcher Anbieter übernimmt
  @Get('tasks')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  tasks(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.listTasks(user.companyId);
  }

  @Put('tasks/:task')
  @RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
  assignTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('task') task: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.ai.assignTask(user, task, dto);
  }

  // Vorschlag für das Anschreiben eines Angebots
  @Post('assist/quote-text')
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.QUOTE_CREATE)
  quoteText(@CurrentUser() user: AuthenticatedUser, @Body() dto: QuoteTextDto) {
    return this.assist.quoteText(user, dto);
  }

  // Zusammenfassung der Baustellen-Nachrichten eines Projekts
  @Post('assist/site-summary')
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.SITE_USE)
  siteSummary(@CurrentUser() user: AuthenticatedUser, @Body() dto: SiteSummaryDto) {
    return this.assist.siteSummary(user, dto);
  }

  // Baustellenfoto beschreiben lassen
  @Post('assist/photo-description')
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.SITE_USE)
  photoDescription(@CurrentUser() user: AuthenticatedUser, @Body() dto: PhotoDescriptionDto) {
    return this.assist.photoDescription(user, dto);
  }
}
