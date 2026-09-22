import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  unit!: string;
}

// Ein Bestandteil ist entweder ein Artikel (mit Menge pro Einheit) oder ein
// Arbeitszeit-Anteil (Minuten pro Einheit) – siehe Punkt 19 im
// Ursprungsdokument (Rezepturen aus Material + Arbeitszeit).
export class AddServiceComponentDto {
  @IsOptional()
  @IsString()
  articleId?: string;

  @ValidateIf((dto: AddServiceComponentDto) => !!dto.articleId)
  @IsNumber()
  @Min(0)
  quantityPer?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  laborMinutes?: number;
}
