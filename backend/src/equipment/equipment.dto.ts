import { DamageSeverity, DamageStatus, EquipmentKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class EquipmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEnum(EquipmentKind)
  kind!: EquipmentKind;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  inventoryNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  licensePlate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsUUID()
  machineId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  retired?: boolean;
}

export class ReportDamageDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;

  @IsEnum(DamageSeverity)
  severity!: DamageSeverity;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;
}

export class UpdateDamageDto {
  @IsEnum(DamageStatus)
  status!: DamageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  repairCost?: number | null;
}

export class MaintenanceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  intervalMonths?: number | null;

  @Matches(DAY)
  nextDue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MaintenanceDoneDto {
  @Matches(DAY)
  doneOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  cost?: number | null;
}

export class DueQueryDto {
  @IsOptional()
  @Matches(DAY)
  until?: string;
}

export class InventoryCountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
}

export class CountItemDto {
  @IsBoolean()
  found!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
