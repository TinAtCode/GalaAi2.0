import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CompleteDto {
  @IsString()
  @MinLength(1)
  prompt!: string;

  // Vom AUFRUFENDEN Modul bereits permission-gefilterter Kontext (siehe
  // Kommentar in ai-provider.interface.ts) – der Gateway selbst filtert
  // hier nichts, er reicht nur durch.
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
