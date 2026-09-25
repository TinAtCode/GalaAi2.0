import { Module } from '@nestjs/common';
import { ChecklistsController, ChecklistTemplatesController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';

@Module({ controllers: [ChecklistTemplatesController, ChecklistsController], providers: [ChecklistsService] })
export class ChecklistsModule {}
