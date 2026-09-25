import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PERMISSIONS } from '../common/permissions';
import { RequirePermissions } from '../common/permissions.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import {
  AddItemDto,
  CommentDto,
  CreateChecklistDto,
  ProposeTemplateDto,
  ReviewDto,
  TemplateDto,
  UpdateItemDto,
} from './checklists.dto';
import { ChecklistsService } from './checklists.service';

// Vorlagen: ansehen und vorschlagen auf der Baustelle (site.use), anlegen,
// ändern und prüfen der Einsatzplaner (checklist.manage, prüft der Service)
@Controller('checklist-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class ChecklistTemplatesController {
  constructor(private checklists: ChecklistsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.checklists.listTemplates(user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TemplateDto) {
    return this.checklists.createTemplate(user, dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TemplateDto,
  ) {
    return this.checklists.updateTemplate(user, id, dto);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.checklists.review(user, id, dto);
  }
}

// Listen am Projekt
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class ChecklistsController {
  constructor(private checklists: ChecklistsService) {}

  @Get('projects/:projectId/checklists')
  list(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.checklists.list(user, projectId);
  }

  @Post('projects/:projectId/checklists')
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateChecklistDto,
  ) {
    return this.checklists.create(user, projectId, dto);
  }

  @Delete('checklists/:id')
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checklists.remove(user, id);
  }

  @Post('checklists/:id/items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddItemDto,
  ) {
    return this.checklists.addItem(user, id, dto);
  }

  @Put('checklists/items/:itemId')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.checklists.updateItem(user, itemId, dto);
  }

  @Delete('checklists/items/:itemId')
  @RequirePermissions(PERMISSIONS.CHECKLIST_MANAGE)
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.checklists.removeItem(user, itemId);
  }

  @Post('checklists/:id/comments')
  comment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.checklists.comment(user, id, dto);
  }

  @Post('checklists/:id/propose-template')
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeTemplateDto,
  ) {
    return this.checklists.proposeTemplate(user, id, dto);
  }
}
