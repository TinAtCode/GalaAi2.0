import { Module } from '@nestjs/common';
import { SiteDiaryController } from './site-diary.controller';
import { SiteDiaryService } from './site-diary.service';

@Module({ controllers: [SiteDiaryController], providers: [SiteDiaryService] })
export class SiteDiaryModule {}
