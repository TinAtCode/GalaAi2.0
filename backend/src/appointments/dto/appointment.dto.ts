import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentStatus } from '@prisma/client';

export class CreateAppointmentDto {
  @IsString()
  projectId!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsDateString()
  startTime!: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;
}

// Plantafel: Termin verschieben oder neu zuteilen. Ohne endTime behält der
// Termin seine Dauer; assignedUserId null = nicht zugeteilt.
export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  endTime?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  assignedUserId?: string | null;
}

export class BoardQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from als Datum angeben, z.B. 2026-09-21.' })
  from!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  days?: number;
}
