import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';

@Module({
  imports: [DocumentsModule],
  controllers: [SiteController],
  providers: [SiteService],
})
export class SiteModule {}
