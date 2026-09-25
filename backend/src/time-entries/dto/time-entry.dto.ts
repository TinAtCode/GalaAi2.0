import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StartTimeEntryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  activity?: string;
}

export class StopTimeEntryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  breakMinutes?: number;
}

// Korrektur durch Vorgesetzte (z.B. vergessenes "Stopp"). Die Begründung ist
// Pflicht und landet im Audit-Log.
export class CorrectTimeEntryDto {
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  breakMinutes?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// mehrere abgeschlossene Einträge auf einmal freigeben
export class ApproveTimeEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}
