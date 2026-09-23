import { Transform, Type } from 'class-transformer';
import {
  IsBIC,
  IsBoolean,
  IsEmail,
  IsIBAN,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Abweichende Erlöskonten für den DATEV-Export (vierstellige Sachkonten)
export class DatevRevenueAccountsDto {
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(9999)
  standard19?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(9999)
  standard7?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(9999)
  smallBusiness?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(9999)
  reverseCharge?: number;
}

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

  // Für die E-Rechnung (XRechnung)
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  // Leerzeichen sind erlaubt und werden entfernt.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value))
  @IsIBAN()
  iban?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value))
  @IsBIC()
  bic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  // Kleinunternehmer nach § 19 UStG
  @IsOptional()
  @IsBoolean()
  smallBusiness?: boolean;

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

  // DATEV: Beraternummer (1001–9999999) und Mandantennummer (1–99999)
  @IsOptional()
  @IsInt()
  @Min(1001)
  @Max(9_999_999)
  datevConsultantNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99_999)
  datevClientNumber?: number;

  @IsOptional()
  @IsIn(['SKR03', 'SKR04'])
  datevChartOfAccounts?: 'SKR03' | 'SKR04';

  @IsOptional()
  @ValidateNested()
  @Type(() => DatevRevenueAccountsDto)
  datevRevenueAccounts?: DatevRevenueAccountsDto;
}
