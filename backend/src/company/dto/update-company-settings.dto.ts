import { IsNumber, IsOptional, IsTimeZone, Min } from 'class-validator';

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

  // z.B. "Europe/Berlin" – bestimmt, wann für die Firma ein Tag beginnt.
  @IsOptional()
  @IsTimeZone()
  timeZone?: string;
}
