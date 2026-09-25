import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Kontobewegungen: ?direction=debit&q=Aral&from=2026-01-01&to=2026-03-31&take=50&skip=0
export class ListTransactionsDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['credit', 'debit'])
  direction?: 'credit' | 'debit';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(DAY, { message: 'from als Datum angeben, z.B. 2026-01-01.' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to als Datum angeben, z.B. 2026-03-31.' })
  to?: string;

  // Kategorie-ID oder "none" (ohne Kategorie)
  @IsOptional()
  @IsString()
  category?: string;
}

export class AssignCategoryDto {
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId!: string | null;

  // für diesen Empfänger als Regel merken
  @IsOptional()
  @IsBoolean()
  createRule?: boolean;
}

export class CategoryNameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name!: string;
}

export class CategoryRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  pattern!: string;

  @IsOptional()
  @IsIn(['any', 'counterparty', 'remittance', 'iban'])
  field?: 'any' | 'counterparty' | 'remittance' | 'iban';
}

// Wiederkehrende Zahlung anlegen oder ändern
export class UpsertRecurringDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(140)
  counterpartyName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  counterpartyIban?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999.99)
  amount?: number;

  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'halfyearly', 'yearly'])
  interval?: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

  @IsOptional()
  @Matches(DAY)
  nextDue?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  endDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// Versicherung oder Vertrag mit Laufzeit und Kündigungsfrist
export class BusinessContractDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(['insurance', 'vehicle', 'lease', 'rent', 'telecom', 'software', 'energy', 'service', 'other'])
  kind!: 'insurance' | 'vehicle' | 'lease' | 'rent' | 'telecom' | 'software' | 'energy' | 'service' | 'other';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  provider?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  contractNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999.99)
  amount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['monthly', 'quarterly', 'halfyearly', 'yearly'])
  interval?: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  termEnd?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(120)
  renewalMonths?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  noticeMonths?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DAY)
  cancelledOn?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  equipmentId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  // Beitrag als Fixkosten führen (Liquiditätsvorschau, Jahresüberblick)
  @IsOptional()
  @IsBoolean()
  asFixedCost?: boolean;

  // erste Abbuchung für die Fixkosten
  @IsOptional()
  @Matches(DAY)
  firstDue?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;
}
