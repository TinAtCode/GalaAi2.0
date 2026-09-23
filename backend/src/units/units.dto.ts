import {
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
} from 'class-validator';
import { ROUNDING_MODES } from '../common/rounding.dto';

// Rundung einer Einheit anpassen oder eigene Einheit anlegen (mit Bezeichnung)
export class UpsertUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(3)
  decimals?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(ROUNDING_MODES)
  rounding?: (typeof ROUNDING_MODES)[number] | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000)
  step?: number | null;
}
