import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export { QuoteStatus } from '@prisma/client';

// Eine Position ist entweder eine Leistung aus dem Katalog (serviceId, der
// Preis kommt aus der Kalkulation) oder eine freie Position mit eigenem
// Text, Einheit und Preis – z.B. Pauschalen oder Einzelleistungen.
class QuoteLineItemInputDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @ValidateIf((line: QuoteLineItemInputDto) => !line.serviceId)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description?: string;

  @ValidateIf((line: QuoteLineItemInputDto) => !line.serviceId)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit?: string;

  // Verkaufspreis je Einheit (netto)
  @ValidateIf((line: QuoteLineItemInputDto) => !line.serviceId)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  unitPrice?: number;

  // Kosten je Einheit (für die Marge); ohne Angabe 0
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  costPerUnit?: number;

  // Genaue Menge (bis 3 Nachkommastellen, z.B. mm in m). Für Angebot und
  // Summe wird sie nach der Rundungsregel gerundet: Position → Leistung →
  // Einheit → Firma (siehe common/units.ts); die genaue Menge bleibt für
  // die Nachkalkulation gespeichert.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  // Rundung nur für diese Position; leer = aus Leistung, Einheit bzw. Firma
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  roundingDecimals?: number;

  @IsOptional()
  @IsIn(['half_up', 'up', 'down'])
  roundingMode?: 'half_up' | 'up' | 'down';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000)
  roundingStep?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99_999_999.99)
  hourlyLaborRateOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  overheadPercentOverride?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  surchargePercentOverride?: number;
}

export class CreateQuoteDto {
  // Umsatzsteuersatz in Prozent (z.B. 19, 7, 0); ohne Angabe gilt der
  // Standardsatz der Firma.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  vatRate?: number;

  // "reverse_charge": § 13b UStG, der Kunde schuldet die Umsatzsteuer.
  // Kleinunternehmer (Firmeneinstellung) stellen immer ohne Umsatzsteuer aus.
  @IsOptional()
  @IsIn(['standard', 'reverse_charge'])
  vatTreatment?: 'standard' | 'reverse_charge';

  @IsString()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemInputDto)
  lineItems!: QuoteLineItemInputDto[];
}

// Entwurf überarbeiten: dieselben Angaben wie beim Anlegen, ohne Projekt
export class UpdateQuoteDto extends OmitType(CreateQuoteDto, ['projectId'] as const) {}

// Kunden sagen "ja"/"nein" auf ein VERSENDETES Angebot – nur diese
// Zielzustände sind über diesen Endpunkt erlaubt (draft/approved/sent
// werden über eigene, permission-getrennte Endpunkte gesetzt).
export class SetQuoteOutcomeDto {
  @IsIn(['accepted', 'rejected', 'expired'])
  status!: 'accepted' | 'rejected' | 'expired';
}
