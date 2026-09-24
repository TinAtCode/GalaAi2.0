import {
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Eingangsrechnung anlegen (alle Pflichtfelder) oder ändern (nur die
// übergebenen); null leert ein optionales Feld
export class UpsertPayableDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  supplierName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  supplierIban?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  invoiceDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  dueDate?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  netAmount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  vatAmount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(20)
  discountPercent?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  discountUntil?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  // Beleg aus POST /finance/payables/extract
  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsIn(['manual', 'text', 'einvoice'])
  source?: 'manual' | 'text' | 'einvoice';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

// Als bezahlt verbuchen: mit einer Abbuchung aus dem Kontoauszug oder von
// Hand mit Datum und Betrag (z.B. bar oder von einem anderen Konto)
export class PayPayableDto {
  @IsOptional()
  @IsString()
  bankTransactionId?: string;

  @IsOptional()
  @Matches(DAY)
  paidAt?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount?: number;
}

export class ListPayablesDto {
  @IsOptional()
  @IsIn(['open', 'paid', 'cancelled', 'all'])
  status?: 'open' | 'paid' | 'cancelled' | 'all';
}
