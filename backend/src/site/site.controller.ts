import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { requiredFile } from '../common/required-file';
import { parseDayParam } from '../common/time-zone';
import { SiteService } from './site.service';
import { MessagesQueryDto, PostMessageDto, PostPhotoDto } from './site.dto';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

// Baustelle (Handy/Tablet): eigener Tag, Nachrichten und Fotos je Projekt
@Controller('site')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SITE_USE)
export class SiteController {
  constructor(private site: SiteService) {}

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    return this.site.today(user.companyId, user.userId, parseDayParam(date));
  }

  @Post('appointments/:id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.site.markDone(user.companyId, user.userId, id);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.site.unread(user.companyId, user.userId);
  }

  @Get('projects/:projectId/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.site.messages(user.companyId, projectId, query.before);
  }

  @Post('projects/:projectId/messages')
  post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.site.postMessage(user.companyId, user.userId, projectId, dto.text, dto.clientId);
  }

  @Post('projects/:projectId/read')
  read(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.site.markRead(user.companyId, user.userId, projectId);
  }

  @Post('projects/:projectId/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  photo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @UploadedFile(requiredFile()) file: Express.Multer.File,
    @Body() dto: PostPhotoDto,
  ) {
    return this.site.postPhoto(user.companyId, user.userId, projectId, file, dto.caption, dto.clientId);
  }

  @Get('photos/:documentId')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { fileName, content } = await this.site.photo(user.companyId, documentId);
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(content);
  }
}
