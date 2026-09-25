import { DiaryDelayReason, DiaryWeather } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class DiaryQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

// Eintrag eines Tages; leere Felder (null) löschen den Wert
export class DiaryEntryDto {
  @IsOptional()
  @IsEnum(DiaryWeather)
  weather?: DiaryWeather | null;

  @IsOptional()
  @IsInt()
  @Min(-40)
  @Max(50)
  temperature?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  crew?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  crewCount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  work?: string | null;

  // Stunden, die die Arbeit stand oder behindert war
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999)
  delayHours?: number | null;

  @IsOptional()
  @IsEnum(DiaryDelayReason)
  delayReason?: DiaryDelayReason | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  delayNote?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
