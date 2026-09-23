import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
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
