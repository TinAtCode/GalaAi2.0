import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { SubscribeDto, UnsubscribeDto } from './push.dto';
import { PushService } from './push.service';

// Jeder angemeldete Nutzer darf seine eigenen Geräte an- und abmelden.
@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  @Get('public-key')
  publicKey() {
    return this.push.publicKey();
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.push.status(user);
  }

  @Post('subscribe')
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user, dto, userAgent);
  }

  @Delete('subscribe')
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(user, dto.endpoint);
  }

  // Probe-Nachricht an die eigenen Geräte
  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser) {
    return this.push.notify(user.companyId, [user.userId], {
      title: 'GartenAI',
      body: 'Benachrichtigungen sind eingeschaltet.',
      url: '/baustelle',
      tag: 'test',
    });
  }
}
