import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyLaborRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultSurchargePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  regularDailyHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeSurchargePercent?: number;
}
