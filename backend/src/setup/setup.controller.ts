import { Body, Controller, Get, Post } from '@nestjs/common';
import { SetupService } from './setup.service';
import { FirstSetupDto } from './setup.dto';

// ohne Anmeldung: nur solange es keinen Nutzer gibt (siehe SetupService)
@Controller('setup')
export class SetupController {
  constructor(private setup: SetupService) {}

  @Get('status')
  status() {
    return this.setup.status();
  }

  @Post()
  create(@Body() dto: FirstSetupDto) {
    return this.setup.setup(dto);
  }
}
