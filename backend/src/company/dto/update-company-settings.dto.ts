import { IsNumber, IsOptional, IsString, IsTimeZone, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateCompanySettingsDto {
  // Firmendaten für Rechnungen (§ 14 UStG)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatId?: string;

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
