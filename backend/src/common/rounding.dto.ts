import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { normalizeUnit } from './units';

export const ROUNDING_MODES = ['half_up', 'up', 'down'] as const;

// Einheit in Katalog-Schreibweise speichern ("qm" -> "m²")
export const NormalizeUnit = () =>
  Transform(({ value }) => (typeof value === 'string' ? normalizeUnit(value) : value));

// Rundung der Mengen für Leistung oder Artikel; null setzt zurück auf
// "aus Einheit bzw. Firma"
export class QuantityRoundingFields {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(3)
  quantityDecimals?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(ROUNDING_MODES)
  quantityRounding?: (typeof ROUNDING_MODES)[number] | null;

  // Schritt statt Nachkommastellen, z.B. 0,5 m oder 0,25 h
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000)
  quantityStep?: number | null;
}
