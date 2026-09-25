import { CalendarScope } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CalendarQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class CreateCalendarEventDto {
  @IsEnum(CalendarScope)
  scope!: CalendarScope;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsDateString()
  startTime!: string;

  @IsOptional()
  @IsDateString()
  endTime?: string | null;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
