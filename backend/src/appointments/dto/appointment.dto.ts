import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const APPOINTMENT_STATUSES = ['planned', 'done', 'cancelled'] as const;

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
  @IsIn(APPOINTMENT_STATUSES)
  status!: (typeof APPOINTMENT_STATUSES)[number];
}
