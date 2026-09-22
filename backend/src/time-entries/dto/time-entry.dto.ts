import { IsInt, IsOptional, IsString, Min } from 'class-validator';

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
  breakMinutes?: number;
}
