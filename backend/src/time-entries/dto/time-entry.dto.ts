import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
