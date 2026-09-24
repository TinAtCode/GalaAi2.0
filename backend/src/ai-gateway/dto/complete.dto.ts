import { IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  prompt!: string;

  // Wofür (z.B. "angebotstext") – geht an eigene Agenten und ins Protokoll
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,60}$/, { message: 'task: nur a–z, 0–9, _ und -' })
  task?: string;

  // Kontext vom aufrufenden Teil der App; das Gateway filtert zusätzlich nach
  // den Rechten des Nutzers (context-filter.ts)
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  // bestimmter Anbieter statt des Standard-Anbieters der Firma
  @IsOptional()
  @IsUUID()
  providerId?: string;
}
