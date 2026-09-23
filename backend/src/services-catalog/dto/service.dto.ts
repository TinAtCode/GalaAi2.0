import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  unit!: string;
}

// Ein Bestandteil ist ein Artikel (mit Menge pro Einheit), ein
// Arbeitszeit-Anteil (Minuten pro Einheit) oder ein Maschineneinsatz
// (Maschine + Minuten pro Einheit) – siehe Punkt 19 im Ursprungsdokument.
export class AddServiceComponentDto {
  @IsOptional()
  @IsString()
  articleId?: string;

  @ValidateIf((dto: AddServiceComponentDto) => !!dto.articleId)
  @IsNumber()
  @Min(0)
  @Max(999_999.9999)
  quantityPer?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  laborMinutes?: number;

  @IsOptional()
  @IsString()
  machineId?: string;

  @ValidateIf((dto: AddServiceComponentDto) => !!dto.machineId)
  @IsInt()
  @Min(1)
  @Max(100_000)
  machineMinutes?: number;
}

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}
