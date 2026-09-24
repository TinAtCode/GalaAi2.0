import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ContractLineDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  // Preis je Einheit (netto) je Abrechnungszeitraum
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  unitPrice!: number;
}

export class ContractTaskDto {
  // vorhandener Einsatz (beim Bearbeiten); ohne id wird er neu angelegt
  @IsOptional()
  @IsString()
  id?: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsInt()
  @Min(1)
  @Max(52)
  everyWeeks!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  seasonFrom?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  seasonTo?: number;

  // Beginn in Minuten nach Mitternacht (Ortszeit), z.B. 480 = 8:00 Uhr
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  // erster (bzw. nächster) Termin
  @Matches(DAY, { message: 'nextDue als Datum angeben, z.B. 2026-04-01.' })
  nextDue!: string;
}

export class CreateContractDto {
  @IsString()
  projectId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @Matches(DAY, { message: 'startDate als Datum angeben, z.B. 2026-04-01.' })
  startDate!: string;

  @IsOptional()
  @Matches(DAY, { message: 'endDate als Datum angeben, z.B. 2027-03-31.' })
  endDate?: string | null;

  @IsIn(['monthly', 'quarterly', 'halfyearly', 'yearly'])
  billingInterval!: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

  @IsOptional()
  @IsBoolean()
  billInAdvance?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99)
  vatRate?: number;

  @IsOptional()
  @IsIn(['standard', 'reverse_charge'])
  vatTreatment?: 'standard' | 'reverse_charge';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines!: ContractLineDto[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractTaskDto)
  tasks!: ContractTaskDto[];
}

export class UpdateContractDto extends CreateContractDto {
  @IsOptional()
  @IsIn(['active', 'paused', 'ended'])
  status?: 'active' | 'paused' | 'ended';
}

export class ScheduleDto {
  // Termine bis einschließlich diesem Tag planen (höchstens ein Jahr voraus)
  @Matches(DAY, { message: 'until als Datum angeben, z.B. 2026-10-31.' })
  until!: string;

  @IsOptional()
  @IsString()
  contractId?: string;
}
