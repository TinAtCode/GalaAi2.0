import { IsNumber, IsOptional, IsTimeZone, Max, Min } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  hourlyLaborRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  overheadPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  defaultSurchargePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  regularDailyHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  overtimeSurchargePercent?: number;

  // Standard-Umsatzsteuersatz für neue Angebote in Prozent.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultVatRate?: number;

  // z.B. "Europe/Berlin" – bestimmt, wann für die Firma ein Tag beginnt.
  @IsOptional()
  @IsTimeZone()
  timeZone?: string;
}
