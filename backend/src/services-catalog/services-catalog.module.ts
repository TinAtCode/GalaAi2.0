import { Module } from '@nestjs/common';
import { ServicesCatalogController } from './services-catalog.controller';
import { ServicesCatalogService } from './services-catalog.service';

@Module({
  controllers: [ServicesCatalogController],
  providers: [ServicesCatalogService],
})
export class ServicesCatalogModule {}
