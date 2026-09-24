import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CalculateServiceDto {
  @IsString()
  serviceId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  // Überschreibt die Firmen-Grundwerte für diese eine Berechnung (z.B. für
  // ein Angebot mit Sonderkonditionen) – macht die Kalkulation konfigurierbar
  // statt starr fest programmiert (siehe Punkt 20 im Ursprungsdokument).
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
