import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateInvoiceFromOrderDto {
  @IsString()
  orderId!: string;

  // partial = Abschlagsrechnung, final = Schlussrechnung
  @IsIn(['partial', 'final'])
  kind!: 'partial' | 'final';

  // Abschlag in Prozent der Auftragssumme (nur bei kind = partial)
  @ValidateIf((dto: CreateInvoiceFromOrderDto) => dto.kind === 'partial')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  percent?: number;

  @IsOptional()
  @IsDateString()
  servicePeriodStart?: string;

  @IsOptional()
  @IsDateString()
  servicePeriodEnd?: string;
}

export class IssueInvoiceDto {
  // Rechnungsdatum; ohne Angabe heute
  @IsOptional()
  @IsDateString()
  issueDate?: string;
}

export class CancelInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SendInvoiceDto {
  // Empfänger; ohne Angabe die E-Mail-Adresse des Kunden
  @IsOptional()
  @IsEmail()
  to?: string;

  // Eigener Text statt des Standardtexts
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  // E-Rechnung (XRechnung) anhängen; Standard: ja
  @IsOptional()
  @IsBoolean()
  withXRechnung?: boolean;
}

// Zahlungseingang zu einer ausgestellten Rechnung
export class RecordPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount!: number;

  // Tag des Zahlungseingangs, z.B. 2026-09-23
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'paidOn als Datum angeben, z.B. 2026-09-23.' })
  paidOn!: string;

  @IsOptional()
  @IsIn(['bank', 'cash', 'other'])
  method?: 'bank' | 'cash' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
