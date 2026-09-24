import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

// Speichern: version aus dem zuletzt geladenen Stand (Schutz gegen
// gegenseitiges Überschreiben); Objekte werden im Service geprüft
export class UpdatePlanDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  // Planeinheiten je Meter (Maßstab); z.B. 50 = 1 m sind 50 Einheiten
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(100_000)
  unitsPerMeter?: number;

  @IsOptional()
  @IsArray()
  objects?: unknown[];
}
